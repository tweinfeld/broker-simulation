const
    _ = require('lodash'),
    path = require('path'),
    kefir = require('kefir'),
    level = require('level'),
    CustomerSite = require('./site'),
    accountRegistryFactory = require('./account'),
    messagingServiceFactory = require('./messaging');

const
    SMS_PRICE = -2,
    INITIAL_ACCOUNT_FUND = 30,
    TWILLIO_SECRET = "464f52c18435010c77f5de975b44a283",
    TWILLIO_ACCOUNT_ID = "ACa4f85bd587cd3e64d75784c956ad05ec";

const
    web = new CustomerSite(),
    registry = accountRegistryFactory({}),
    messenger = messagingServiceFactory({ twillio_secret: TWILLIO_SECRET, twillio_account_id: TWILLIO_ACCOUNT_ID });

web.on('register_new_account', ({ callback, payload: accountInfo })=> {
    kefir
        .fromPromise(registry.register(accountInfo))
        .flatMap(({ account_id })=> {
            return kefir
                .fromPromise(registry.registerTransaction({ account_id, amount: INITIAL_ACCOUNT_FUND, reference: { type: "registration_deposit" }}))
                .map(()=> ({ account_id }));
        })
        .onValue(callback.bind(null, null))
        .onError(callback);
});

web.on('request_account_details', ({ callback, payload: { account_id } })=> registry
    .get({ account_id })
    .then(callback.bind(null, null), callback));

web.on('request_account_validation', ({ callback, payload: { account_id, ip } })=> {
    kefir
        .fromPromise(registry.requestAccountValidationTicket({ account_id, meta: { ip } }))
        .flatMap(({ account, code })=> kefir.fromPromise(messenger.send({ to_phone: account["owner_phone"], message: `Your verification code is "${code}"`, reference: { type: "account_validation" } })))
        .onValue(callback.bind(null, null))
        .onError(callback);
});

web.on('request_account_validation_check', ({ callback, payload: { account_id, code } })=> registry
    .validateAccount({ account_id, ticket_code: code })
    .then(callback.bind(null, null), callback));

web.on('request_account_balance', ({ callback, payload: { account_id } })=> registry
    .getBalance({ account_id })
    .then(callback.bind(null, null), callback));

web.on('request_account_transaction', ({ callback, payload: { account_id } })=> registry
    .getTransaction({ account_id })
    .then(callback.bind(null, null), callback));

web.on('send_message', ({ callback, payload: { account_id, message, phone }})=> {
    kefir
        .fromPromise(registry.getBalance({ account_id }))
        .flatMap((balance)=> (balance + SMS_PRICE < 0)
            ? kefir.constantError('Insufficient Balance Funds')
            : kefir
                .fromPromise(messenger.send({ message, to_phone: phone, reference: { type: "user_message" } }))
                .mapErrors(_.constant('Error Delivering Message'))
                .flatMap(({ id })=> kefir.fromPromise(registry.registerTransaction({ account_id, reference: { type: "sms", id }, amount: SMS_PRICE })))
        )
        .onValue(callback.bind(null, null))
        .onError(callback);
});