const
    path = require('path'),
    uuid = require('uuid/v4'),
    kefir = require('kefir'),
    request = require('request');

const
    DEFAULT_FOLDER = "./.db",
    DEFAULT_SENDER_PHONE = "+15005550006";

module.exports = function({
    twillio_secret,
    twillio_account_id,
    sender_phone = DEFAULT_SENDER_PHONE
}){
    return {
        send({ to_phone, message, reference = {} }){
            console.log(message);
            return kefir
                .fromNodeCallback((cb)=> request({
                    method: "POST",
                    uri: `https://api.twilio.com/2010-04-01/Accounts/${twillio_account_id}/Messages.json`,
                    json: true,
                    form: {
                        Body: message,
                        To: to_phone,
                        From: sender_phone
                    },
                    auth: {
                        user: twillio_account_id,
                        password: twillio_secret
                    }
                }, cb))
                .flatMap(({ body, statusCode })=> kefir[(~~(statusCode / 100) !== 2) ? "constantError" : "constant"](body))
                .map(()=>({ create: Date.now(), id: uuid() }))
                .toPromise();
        }
    };
};