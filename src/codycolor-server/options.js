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
}());