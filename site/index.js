const
    _ = require('lodash'),
    jwt = require('jsonwebtoken'),
    path = require('path'),
    uuid = require('uuid/v4'),
    cors = require('cors'),
    level = require('level'),
    kefir = require('kefir'),
    assert = require('assert'),
    express = require('express'),
    bodyParser = require('body-parser'),
    { EventEmitter } = require('events');

const
    DEFAULT_PUBLIC_FOLDER = "/public",
    DEFAULT_PORT = 8080,
    DEFAULT_RPC_TIMEOUT = 1000,
    DEFAULT_TOKEN_EXPIRATION = "7 days",
    DEFAULT_TOKEN_SIGNATURE_SECRET = "UMBZiQeqoU",
    MIN_CHARACTERS_OWNER_FULL_NAME = 2,
    MAX_CHARACTERS_OWNER_FULL_NAME = 150;

const
    sendRpcFactory = (emitter, timeout = DEFAULT_RPC_TIMEOUT)=>
        (eventName, payload = {})=> new Promise((resolve, reject)=> {
            const callback = (err, value)=> err
                ? reject(_.isError(err) ? err : new Error(err))
                : resolve(value);
            _.delay(()=> callback(new Error(`RPC timed out after ${timeout}ms calling to "${eventName}"`)), timeout);
            emitter.emit(eventName, { callback, payload });
    }),
    lengthBetween = (minCharacterLength = 0, maxCharacterLength = 0)=> {
        const regExp = new RegExp(`^.{${minCharacterLength},${maxCharacterLength}}$`);
        return (text)=> regExp.test(text);
    },
    isPhoneNumber = (phoneNumber)=> /\+(9[976]\d|8[987530]\d|6[987]\d|5[90]\d|42\d|3[875]\d|2[98654321]\d|9[8543210]|8[6421]|6[6543210]|5[87654321]|4[987654310]|3[9643210]|2[70]|7|1)\d{1,14}$/.test(phoneNumber),
    validateNotEmpty = _.negate(_.isEmpty),
    validateFullName = _.overEvery(validateNotEmpty, lengthBetween(MIN_CHARACTERS_OWNER_FULL_NAME, MAX_CHARACTERS_OWNER_FULL_NAME)),
    validatePhoneNumber = _.overEvery(validateNotEmpty, isPhoneNumber),
    requireValidatedAccount = (req, res, next)=> next(!_.get(req, 'account.valid', false) && new Error('Account is not verified'));

module.exports = class extends EventEmitter {

    constructor({
            port = DEFAULT_PORT,
            token_signature_secret: tokenSignatureSecret = DEFAULT_TOKEN_SIGNATURE_SECRET
        } = {}) {

        super();

        (tokenSignatureSecret === DEFAULT_TOKEN_SIGNATURE_SECRET && console.warn('!! Using default token signature !!'));

        const
            app = express(),
            sendRpc = sendRpcFactory(this);

        app.set('views', path.join(__dirname, 'view'));
        app.use('/api', cors());
        app.use('/api', bodyParser.json());
        app.use('/api', (req, res, next)=> {
            let token = _.attempt(()=> _.flow(_.property('headers.authorization'), (txt = '')=> txt.match(/Bearer\s*([^\s]+)/i), _.property(1), _.partial(jwt.verify, _, tokenSignatureSecret))(req));
            _.isError(token)
                ? next(new Error('Invalid token!'))
                : sendRpc('request_account_details', { account_id: _.get(token, 'account_id') })
                    .then((account) => {
                        req["account"] = account;
                        next(null);
                    }, next);
        });

        app.param('account_id', (req, res, next, account_id) => {
            assert(/^(\{{0,1}([0-9a-fA-F]){8}-([0-9a-fA-F]){4}-([0-9a-fA-F]){4}-([0-9a-fA-F]){4}-([0-9a-fA-F]){12}\}{0,1})$/.test(account_id), 'Invalid account id');
            sendRpc('request_account_details', {account_id})
                .then((account) => {
                    req["account"] = account;
                    next(null);
                }, next);
        });

        app.get('/api/account/transaction', requireValidatedAccount, (req, res, next)=> {
            let account = _.get(req, 'account');
            kefir
                .combine(["request_account_transaction", "request_account_balance"].map((eventName)=> kefir.fromPromise(sendRpc(eventName, { account_id: account["id"] }))))
                .map(_.partial(_.zipObject, ["transaction", "balance"]))
                .onValue(res.status(200).json.bind(res))
                .onError(next);
        });

        app.post('/api/account/send_message', requireValidatedAccount, (req, res, next)=> {
            const
                account = _.get(req, 'account'),
                [message, phone] = _.at(req.body, 'message', 'phone');

            assert(validatePhoneNumber(phone), `Invalid phone number`);
            assert(validateNotEmpty(message), `Message cannot be empty`);

            sendRpc('send_message', { account_id: account["id"], message, phone })
                .then(res.status(200).json.bind(res), next);
        });

        app.post('/api/account/validate', (req, res, next) => {
            sendRpc('request_account_validation', { ip: req.ip, account_id: _.get(req, 'account.id') })
                .then(() => res.status(200).json({}), next);
        });

        app.post('/api/account/validate_check', (req, res, next) => {
            sendRpc('request_account_validation_check', {
                code: _.get(req, 'body.code'),
                account_id: _.get(req, 'account.id')
            })
            .then(() => res.status(200).json({}), next);
        });

        app.get('/api/account', (req, res)=> {
            res.json(_.get(req, 'account'));
        });

        app.use((err, req, res, next) => res.status(500).json({ description: err.message }));

        app.get('/', (req, res)=> {
            res.render('register.ejs', { error: null });
        });

        app.post('/', bodyParser.urlencoded({ extended: false }), (req, res)=> {

            let {owner_full_name, owner_phone} = req.body;

            kefir
                .fromNodeCallback((cb)=> {
                    let validation = _.attempt(()=> {
                        assert(validateFullName(owner_full_name), `Account owner's full name is invalid`);
                        assert(validatePhoneNumber(owner_phone), `Account owner's phone number is invalid`);
                    });

                    cb(_.isError(validation) ? validation.message : null);
                })
                .flatMap(()=> {
                    return kefir
                        .fromPromise(sendRpc('register_new_account', { owner_full_name, owner_phone }))
                        .flatMap(({ account_id }) => kefir.fromNodeCallback(_.partial(jwt.sign, { account_id }, tokenSignatureSecret, { expiresIn: DEFAULT_TOKEN_EXPIRATION })))
                })
                .onError((error)=> res.render('register.ejs', { error }))
                .onValue((token)=> res.redirect(`/status.html?token=${token}`));

        });

        app.use(express.static(path.join(__dirname, DEFAULT_PUBLIC_FOLDER)));
        app.listen(8080);
    }
};