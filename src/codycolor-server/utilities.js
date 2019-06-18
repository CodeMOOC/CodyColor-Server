/*
 * utilities.js: file che raggruppa metodi di supporto utilizzati da molteplici file, come il metodo per la stampa dei
 * log o determinate costanti
 */
(function () {
    // crea un log formattato in modo corretto
    module.exports.printLog = function(isFinal, text) {
        let final = (isFinal ? 'x' : '.');
        let utcDate = (new Date()).toUTCString();
        console.log(' [%s] [%s] %s', final, utcDate, text);
    };


    module.exports.printProgramHeader = function() {
        module.exports.printLog(false, 'CodyColor gameServer');
        module.exports.printLog(false, 'Project by Riccardo Maldini');
        module.exports.printLog(false, '');
    };


    module.exports.requiredClientVersion  = '1.0.9';


    module.exports.gameTypes = {
        custom: 'custom',
        random: 'random',
        royale: 'royale'
    };


    module.exports.gameRoomStates = {
        mmaking: 'mmaking',
        playing: 'playing',
        free:    'free'
    };
    

    module.exports.messageTypes = {
        gameRequest:      "gameRequest",
        gameResponse:     "gameResponse",
        heartbeat:        "heartbeat",
        tilesRequest:     "tilesRequest",
        tilesResponse:    "tilesResponse",
        connectedSignal:  "connectedSignal",
        generalInfo:      "generalInfo",
        here:             "here",
        ready:            "ready",
        playerPositioned: "playerPositioned",
        skip:             "skip",
        chat:             "chat",
        quitGame:         "quitGame"
    };
}());