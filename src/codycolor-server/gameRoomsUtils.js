/*
 * gameRoomsUtils.js: metodi comuni utilizzati in più tipologie di game room
 */
(function () {
    let utils = require("./utils");
    let commonCallbacks = {};

    // costanti utilizzate per tener traccia della tipologia di game room
    module.exports.gameTypes = {
        custom: 'custom',
        random: 'random',
        royale: 'royale'
    };


    // costanti utilizzate per tener traccia dello stato attuale di ogni game room
    module.exports.gameRoomStates = {
        mmaking:    'mmaking',
        playing:    'playing',
        aftermatch: 'aftermatch',
        free:       'free'
    };


    // inizializza i callbacks utilizzati in molteplici tipologie di game room
    module.exports.setCommonCallbacks = function (newCallbacks) {
        commonCallbacks = newCallbacks;
    };


    // esponi all'esterno i callbacks di cui sopra
    module.exports.commonCallbacks = commonCallbacks;



    // algoritmo per la stampa a console lo stato attuale delle game room
    module.exports.printGameRooms = function (gameRooms) {
        utils.printLog(false, 'New ' + gameRooms.gameData.gameType +' game room configuration:');

        if (gameRooms.length <= 0) {
            utils.printLog(false, 'empty');

        } else {
            let gameRoomString = '';
            for (let gameRoomIndex = 0; gameRoomIndex < gameRooms.length; gameRoomIndex++) {
                gameRoomString += gameRoomIndex.toString() + '[';
                for (let playerIndex = 0; playerIndex < gameRooms[gameRoomIndex].players.length; playerIndex++) {
                    gameRoomString += (gameRooms[gameRoomIndex].players[playerIndex].occupiedSlot ? 'x' : 'o');
                }
                gameRoomString += '] ';
                if (gameRoomIndex % 4 === 0 && gameRoomIndex !== 0) {
                    utils.printLog(false, gameRoomString);
                    gameRoomString = '';
                }
            }
            if (gameRoomString !== '')
                utils.printLog(false, gameRoomString);
        }
    };


    // algoritmo per la generazione della stringa rappresentante la disposizione dell tiles di un match
    module.exports.generateTiles = function() {
        let tiles = '';
        for (let i = 0; i < 25; i++) {
            switch (Math.floor(Math.random() * 3)) {
                case 0:
                    tiles += 'R';
                    break;
                case 1:
                    tiles += 'Y';
                    break;
                case 2:
                    tiles += 'G';
                    break;
            }
        }
        return tiles;
    };


    // algoritmo per la generazione del codice univoco a 4 cifre utilizzato per iscriversi alla game room
    module.exports.generateUniqueCode = function (gameRooms) {
        let newCode = '0000';
        let unique = true;
        do {
            newCode = (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString();

            unique = true;
            for (let i = 0; i < gameRooms.length; i++) {
                if (newCode === gameRooms[i].code)
                    unique = false;
            }
        } while (!unique);

        return newCode;
    };
}());