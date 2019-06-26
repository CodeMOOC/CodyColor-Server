/*
 * options.js: gestisce la memorizzazione di vari parametri di controllo. Alcuni di questi vanno memorizzati su file:
 * questo modulo ne gestisce anche la memorizzazione
 */
(function () {
    let utilities  = require("./utilities");
    let fileSystem = require("fs");

    let sessionOptions = {
        connectedPlayers:     0,
        randomWaitingPlayers: 0
    };

    let persistentOptions = {
        totalMatches: 0  // valore di inizializzazione
    };

    // path del file. In caso di simulazione in locale, utilizza il percorso stesso del programma
    const optionsFilePath = (process.argv[2] === '-l') ?
        "./codyColorServerOptions.json" : "/data/codyColorServerOptions2.json";

    // leggi il file se presente; altrimenti, creane uno nuovo
    fileSystem.readFile(optionsFilePath, 'utf8', function (error, data) {
        if (error) {
            utilities.printLog(false, 'First writing options file');
            fileSystem.writeFile(optionsFilePath, JSON.stringify(persistentOptions), 'utf8', function (error) {
                if (error)
                    utilities.printLog(false, 'Error creating options file: ' + error);
                else
                    utilities.printLog(false, 'Options file created')
            });

        } else {
            utilities.printLog(false, 'Options file found. Reading...');
            persistentOptions = JSON.parse(data);
            utilities.printLog(false, 'Ready: ' + JSON.stringify(persistentOptions));
        }
    });


    module.exports.setConnectedPlayers = function (newValue) {
        sessionOptions.connectedPlayers = newValue;
    };


    module.exports.getConnectedPlayers = function () {
        if (sessionOptions.connectedPlayers === undefined)
            sessionOptions.connectedPlayers = 0;

        return sessionOptions.connectedPlayers;
    };


    module.exports.setRandomWaitingPlayers = function (newValue) {
        sessionOptions.randomWaitingPlayers = newValue;
    };


    module.exports.getRandomWaitingPlayers = function () {
        if (sessionOptions.randomWaitingPlayers === undefined)
            sessionOptions.randomWaitingPlayers = 0;

        return sessionOptions.randomWaitingPlayers;
    };


    module.exports.addTotalMatches = function () {
        if (persistentOptions.totalMatches === undefined)
            persistentOptions.totalMatches = 0;

        persistentOptions.totalMatches++;
        updateOptionsFile();
    };


    module.exports.getTotalMatches = function () {
        if (persistentOptions.totalMatches === undefined)
            persistentOptions.totalMatches = 0;

        return persistentOptions.totalMatches;
    };


    // aggiorna il file di opzioni salvato in memoria
    let updateOptionsFile = function() {
        fileSystem.writeFile(optionsFilePath, JSON.stringify(persistentOptions), 'utf8', function (error) {
            if (error)
                utilities.printLog(false, 'Error saving options file: ' + error);
            else
                utilities.printLog(false, 'Options file saved')
        });
    }
}());