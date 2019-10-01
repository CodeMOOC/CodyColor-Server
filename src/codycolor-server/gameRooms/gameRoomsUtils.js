/*
 * gameRooms/gameRoomsUtils.js: metodi comuni utilizzati in più tipologie di game room
 */
(function () {
    // costanti utilizzate per tener traccia della tipologia di game room
    module.exports.gameTypes = {
        custom: 'custom',
        random: 'random',
        royale: 'royale'
    };


    // costanti utilizzate per tener traccia dello stato attuale di ogni game room
    module.exports.states = {
        mmaking:    'mmaking',
        playing:    'playing',
        aftermatch: 'aftermatch',
        free:       'free'
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