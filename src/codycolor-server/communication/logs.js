/*
 * logs.js: file che raggruppa metodi per la stampa formattata di log a console.
 */
(function () {
    // crea un log formattato in modo corretto
    let print = function(text) {
        let utcDate = (new Date()).toUTCString();
        console.log('[%s] %s', utcDate, text);
    };


    // stampa l'header iniziale dello script
    module.exports.printProgramHeader = function() {
        print('CodyColor Game Server');
        print('Project by Riccardo Maldini');
        print('');
    };


    module.exports.printWaiting = function() {
        print('...');
    };


    // esporta all'esterno il metodo generico per la stampa formattata dei log
    module.exports.printLog = function (text) {
        print(text);
    };
}());