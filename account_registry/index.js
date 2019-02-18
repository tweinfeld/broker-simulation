const
    _ = require('lodash'),
    path = require('path'),
    uuid = require('uuid/v4'),
    level = require('level'),
    kefir = require('kefir'),
    uuidv5 = require('uuid/v5'),
    crypto = require('crypto');

const
    SECOND = 1000,
    MINUTE = 60 * SECOND,
    DEFAULT_DATABASE_FOLDER = "./.db",
    ACCOUNT_VALIDATION_TICKET_EXPIRATION = 5 * MINUTE,
    DEFAULT_TRANSACTION_HISTORY_LIMIT = 10;

const
    lineNoTemplate = (lineNo)=> _.padStart(lineNo, 10, '0'),
    keyTemplateAccountId = (accountId)=> ["account", accountId].join(':'),
    keyTemplateAccountValidationTicket = (accountId, ticketId)=> ["validation_ticket", uuidv5(ticketId, accountId)].join(':'),
    keyTemplateAccountFund = (accountId, lineNo = 0)=> ["transaction", accountId, lineNoTemplate(lineNo)].join(':'),
    validationCodeGenerator = ()=> _.padStart(_.random(0, 9999), 4, '0');

module.exports = function({ database_folder: databaseFolder = path.join(__dirname, DEFAULT_DATABASE_FOLDER) }){

    const db = level(databaseFolder);

    return {
        register({
            owner_full_name: ownerFullName,
            owner_phone: ownerPhone
        }){
            const newAccountId = uuid();
            return db
                .put(keyTemplateAccountId(newAccountId), JSON.stringify({
                    create: Date.now(),
                    owner_full_name: ownerFullName,
                    owner_phone: ownerPhone,
                    valid: false
                }))
                .then(
                    ()=> ({ account_id: newAccountId }),
                    (err)=> { throw(Object.assign(new Error('An error occurred while trying to register a new user'), { source: err })); }
                );
        },
        get({ account_id: accountId }){
            return db.get(keyTemplateAccountId(accountId)).then(_.flow(JSON.parse, _.partial(_.assign, { id: accountId })));
        },
        requestAccountValidationTicket({ account_id: accountId, meta = {} }){
            return kefir
                .fromPromise(this.get({ account_id: accountId }))
                .flatMap((account)=> {
                    return account["valid"]
                        ? kefir.constantError('Account already validated')
                        : ((ticketCode)=> kefir
                            .fromPromise(db.put(keyTemplateAccountValidationTicket(accountId, 'ticket'), JSON.stringify({ code: ticketCode, create: Date.now(), meta })))
                            .map(_.constant({ account, code: ticketCode }))
                        )(validationCodeGenerator())
                })
                .toPromise();
        },
        validateAccount({ account_id: accountId, ticket_code: ticketCode }){
            return kefir
                    .fromPromise(db.get(keyTemplateAccountValidationTicket(accountId, 'ticket')))
                    .flatMap(_.flow(JSON.parse, ({ create: createTs, code })=> {
                        return (code === ticketCode) && (Date.now() < (createTs + ACCOUNT_VALIDATION_TICKET_EXPIRATION))
                            ? kefir
                                .fromPromise(this.get({ account_id: accountId }))
                                .flatMap((account)=> kefir.fromPromise(db.put(keyTemplateAccountId(accountId), JSON.stringify({ ...account, valid : true }))))
                            : kefir.constantError('Ticket invalid')
                    }))
                    .toPromise();
        },
        registerTransaction({ account_id, amount = 0, reference = { "type": "debug" } }){
            let keyStream = db.createKeyStream({
                gte: keyTemplateAccountFund(account_id, 0),
                lte: ["transaction", account_id, "~"].join(':'),
                reverse: true,
                limit: 1
            });

            return kefir
                .fromEvents(keyStream, 'data')
                .takeUntilBy(kefir.fromEvents(keyStream, 'end').take(1))
                .beforeEnd(_.constant("0"))
                .take(1)
                .map((str)=> Number(str.split(':').pop()))
                .flatMap((lineNo)=> kefir.fromPromise(db.put(keyTemplateAccountFund(account_id, lineNo + 1), JSON.stringify({ amount, ts: Date.now(), reference }))))
                .toPromise();
        },
        getTransaction({ account_id, limit = DEFAULT_TRANSACTION_HISTORY_LIMIT }){
            let dataStream = db.createReadStream({
                gte: keyTemplateAccountFund(account_id, 0),
                lte: ["transaction", account_id, "~"].join(':'),
                keys: false,
                reverse: true,
                limit
            });

            return kefir
                .fromEvents(dataStream, 'data')
                .takeUntilBy(kefir.fromEvents(dataStream, 'end').take(1))
                .map(JSON.parse)
                .scan(_.concat, [])
                .last()
                .toPromise();
        },
        getBalance({ account_id }){
            let dataStream = db.createReadStream({
                gte: keyTemplateAccountFund(account_id, 0),
                lte: ["transaction", account_id, "~"].join(':'),
                keys: false
            });

            return kefir
                .fromEvents(dataStream, 'data')
                .takeUntilBy(kefir.fromEvents(dataStream, 'end').take(1))
                .map(_.flow(JSON.parse, _.property('amount')))
                .scan(_.add, 0)
                .last()
                .toPromise();
        }
    }
};