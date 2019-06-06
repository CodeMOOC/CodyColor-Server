/*
 * customGameRooms.js: file per la gestione dell'array gameRoom ad accoppiamento personalizzato dei giocatori. Espone metodi
 * per l'aggiunta e la rimozione dei giocatori, oltre a metodi per recuperare informazioni sullo stato delle game room.
 */
(function () {
    let utilities = require("./utilities");
    let customGameRooms = [];
    let callbacks = {};
    const gameRoomStates = utilities.gameRoomStates;


    // inizializza i callbacks utilizzati dal modulo
    module.exports.setCallbacks = function(onGameRoomsUpdated, onHeartbeatExpired) {
        callbacks.onGameRoomsUpdated = onGameRoomsUpdated;
        callbacks.onHeartbeatExpired = onHeartbeatExpired;
    };


    // fornisce il conteggio complessivo dei giocatori attivi sulle game room ad accoppiamento casuale
    module.exports.getConnectedPlayers = function() {
        let connectedPlayers = 0;
        for (let i = 0; i < customGameRooms.length; i++) {
            for (let j = 0; j < customGameRooms[i].players.length; j++)
                if (customGameRooms[i].players[j].occupiedSlot)
                    connectedPlayers++;
        }
        return connectedPlayers;
    };


    // stampa a console le gameRoom attive ad accoppiamento personalizzato
    module.exports.printGameRooms = function() {
        utilities.printLog(false, 'New custom game room configuration:');

        if (customGameRooms.length <= 0) {
            utilities.printLog(false, 'empty');

        } else {
            let gameRoomString = '';
            for (let i = 0; i < customGameRooms.length; i++) {
                let firstSlot = (customGameRooms[i].players[0].occupiedSlot ? 'x' : 'o');
                let secondSlot = (customGameRooms[i].players[1].occupiedSlot ? 'x' : 'o');
                gameRoomString += i.toString() + '[' + firstSlot + '' + secondSlot + '] ';
                if (i % 4 === 0 && i !== 0) {
                    utilities.printLog(false, gameRoomString);
                    gameRoomString = '';
                }
            }
            if (gameRoomString !== '')
                utilities.printLog(false, gameRoomString);
        }
    };


    // verifica se i dati del giocatore sono validi
    module.exports.isPlayerDataValid = function(gameRoomId, playerId) {
        return gameRoomId !== -1
            && playerId !== -1
            && customGameRooms.length !== 0
            && gameRoomId <= customGameRooms.length
            && customGameRooms[gameRoomId] !== undefined
            && customGameRooms[gameRoomId].players[playerId] !== undefined;
    };


    // aggiunge un riferimento all'utente nel primo slot valido.
    // Ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente.
    // L'eventuale callback passato viene eseguito non appena le gameRoom vengono aggiornate
    module.exports.addUserToGameRoom = function(args) {
        let responseValue = undefined;

        if (args.fromInvitation === undefined || !args.fromInvitation)
            responseValue = addOrganizerPlayer();
        else
            responseValue = addInvitedPlayer(args.invitationCode);

        callbacks.onGameRoomsUpdated();
        return responseValue;
    };


    let addOrganizerPlayer = function() {
        let newPlayerGameRoomId = undefined;

        // cerca il primo slot libero tra le gameRoom
        for (let gRoomIndex = 0; gRoomIndex < customGameRooms.length; gRoomIndex++) {
            if (customGameRooms[gRoomIndex].state === gameRoomStates.free) {
                newPlayerGameRoomId = gRoomIndex;
            }
        }

        // non c'è uno slot libero: crea una nuova game room
        if (newPlayerGameRoomId === undefined) {
            customGameRooms.push(generateFreeGameRoom());
            customGameRooms[customGameRooms.length - 1].state = gameRoomStates.mmaking;
            newPlayerGameRoomId = customGameRooms.length - 1;
        }

        // inserisci il giocatore nella game room
        customGameRooms[newPlayerGameRoomId].players[0] = generateOccupiedSlot(newPlayerGameRoomId, 0);

        return {
            gameRoomId: newPlayerGameRoomId,
            playerId:   0,
            state:      gameRoomStates.mmaking,
            code:       customGameRooms[newPlayerGameRoomId].code
        };
    };


    let addInvitedPlayer = function(invitationCode) {
        // si è stati invitati: cerca la gameRoom che ha proposto la partita
        let newPlayerGameRoomId = undefined;
        for (let gRoomIndex = 0; gRoomIndex < customGameRooms.length; gRoomIndex++) {
            if (customGameRooms[gRoomIndex].code.toString() === invitationCode.toString()
                && customGameRooms[gRoomIndex].state === gameRoomStates.mmaking
                && !customGameRooms[gRoomIndex].players[1].occupiedSlot) {
                newPlayerGameRoomId = gRoomIndex;
            }
        }

        if (newPlayerGameRoomId !== undefined) {
            // gameRoom trovata: aggiungi giocatore
            customGameRooms[newPlayerGameRoomId].players[1] = generateOccupiedSlot(newPlayerGameRoomId, 1);
            return {
                gameRoomId: newPlayerGameRoomId,
                playerId:   1,
                code:       customGameRooms[newPlayerGameRoomId].code,
                state:      gameRoomStates.mmaking
            };
        }
    };


    // rimuove un utente dalla propria gameRoom
    module.exports.removeUserFromGameRoom = function(gameRoomId, playerId) {
        if (module.exports.isPlayerDataValid(gameRoomId, playerId)) {
            // pulisci lo slot giocatore
            clearTimeout(customGameRooms[gameRoomId].players[playerId].heartBeatTimer);
            customGameRooms[gameRoomId].players[playerId] = generateFreeSlot();

            // pulisci la game room se necessario
            if (customGameRooms[gameRoomId].state === gameRoomStates.playing) {
                let noPlayers = true;
                for (let playerIndex = 0; playerIndex < customGameRooms[gameRoomId].players.length; playerIndex++) {
                    if (customGameRooms[gameRoomId].players[playerIndex].occupiedSlot)
                        noPlayers = false;
                }

                if (noPlayers)
                    customGameRooms[gameRoomId] = generateFreeGameRoom();
            }

            // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
            for (let gRoomIndex = customGameRooms.length - 1; gRoomIndex >= 0; gRoomIndex--) {
                if (customGameRooms[gRoomIndex].state === gameRoomStates.free)
                    customGameRooms.splice(gRoomIndex, 1);
                else
                    break;
            }

            callbacks.onGameRoomsUpdated();
        }
    };


    // aggiorna il timer heartbeat di un giocatore. invocato all'arrivo di un messaggio di heartbeat
    module.exports.updateHeartBeat = function(gameRoomId, playerId) {
        if (module.exports.isPlayerDataValid(gameRoomId, playerId)) {
            clearTimeout(customGameRooms[gameRoomId].players[playerId].heartBeatTimer);
            customGameRooms[gameRoomId].players[playerId].heartBeatTimer
                = generateHeartbeatTimer(gameRoomId, playerId);
        }
    };


    module.exports.startMatch = function(gameRoomId) {
        customGameRooms[gameRoomId].state = gameRoomStates.playing;
    };


    let generateFreeGameRoom = function() {
        return {
            players: [ generateFreeSlot(), generateFreeSlot() ],
            state:   gameRoomStates.free,
            code:    generateUniqueCode()
        };
    };


    let generateFreeSlot = function() {
        return {
            occupiedSlot: false,
            heartBeatTimer: undefined
        };
    };


    let generateOccupiedSlot = function(gameRoomId, playerId) {
        return {
            occupiedSlot: true,
            heartBeatTimer: generateHeartbeatTimer(gameRoomId, playerId)
        };
    };


    let generateHeartbeatTimer = function(gameRoomId, playerId) {
        return setTimeout(function() {
            callbacks.onHeartbeatExpired(gameRoomId, playerId)
        }, 10000);
    };


    let generateUniqueCode = function() {
        let newCode = '0000';
        let unique = true;
        do {
            newCode = (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString();

            unique = true;
            for (let i = 0; i < customGameRooms.length; i++) {
                if (newCode === customGameRooms[i].code)
                    unique = false;
            }
        } while (!unique);

        return newCode;
    };
}());