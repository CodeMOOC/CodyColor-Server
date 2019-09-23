/*
 * utils.js: file che raggruppa metodi di supporto utilizzati in più moduli.
 */
(function () {

    // todo da modificare manualmente ad ogni aggiornamento
    module.exports.requiredClientVersion  = '3.0.8';


    // crea un log formattato in modo corretto
    let printLog = function(isFinal, text) {
        let final = (isFinal ? 'x' : '.');
        let utcDate = (new Date()).toUTCString();
        console.log(' [%s] [%s] %s', final, utcDate, text);
    };


    // esporta all'esterno il metodo per la stampa formattata dei log
    module.exports.printLog = function (text) {
        printLog(false, text);
    };


    // stampa l'header iniziale dello script
    module.exports.printProgramHeader = function() {
        printLog(false, 'CodyColor Game Server');
        printLog(false, 'Project by Riccardo Maldini');
        printLog(false, '');
    };


    module.exports.printWaiting = function() {
        printLog(true, '...');
    };
}());