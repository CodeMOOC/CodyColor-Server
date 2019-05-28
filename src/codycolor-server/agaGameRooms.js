/*
 * customGameRooms.js: file per la gestione dell'array gameRoom ad accoppiamento personalizzato dei giocatori. Espone metodi
 * per l'aggiunta e la rimozione dei giocatori, oltre a metodi per recuperare informazioni sullo stato delle game room.
 */
(function () {
    let   utilities      = require("./utilities");
    let   agaGameRooms   = [];
    let   callbacks      = {};
    const gameRoomStates = utilities.gameRoomStates;


    // inizializza i callbacks utilizzati dal modulo
    module.exports.setCallbacks = function(onGameRoomsUpdated, onHeartbeatExpired) {
        callbacks.onGameRoomsUpdated = onGameRoomsUpdated;
        callbacks.onHeartbeatExpired = onHeartbeatExpired;
    };


    // fornisce il conteggio complessivo dei giocatori attivi sulle game room ad accoppiamento casuale
    module.exports.getConnectedPlayers = function() {
        let connectedPlayers = 0;
        for (let gameRoomIndex = 0; gameRoomIndex < agaGameRooms.length; gameRoomIndex++) {
            for (let playerIndex = 0; playerIndex < agaGameRooms[gameRoomIndex].players.length; playerIndex++)
                if (agaGameRooms[gameRoomIndex].players[playerIndex].occupiedSlot)
                    connectedPlayers++;
        }
        return connectedPlayers;
    };


    // stampa a console le gameRoom attive ad accoppiamento personalizzato
    module.exports.printGameRooms = function() {
        utilities.printLog(false, 'New aga game room configuration:');

        if (agaGameRooms.length <= 0) {
            utilities.printLog(false, 'empty');

        } else {
            let gameRoomString = '';
            for (let gameRoomIndex = 0; gameRoomIndex < agaGameRooms.length; gameRoomIndex++) {
                gameRoomString = gameRoomIndex.toString() + '[';
                for (let playerIndex = 0; playerIndex < agaGameRooms[gameRoomIndex].players.length; playerIndex++) {
                   gameRoomString += (agaGameRooms[gameRoomIndex].players[playerIndex].occupiedSlot ? 'x' : 'o');
                }
                gameRoomString += '] ';
                if (gameRoomIndex % 4 === 0 && gameRoomIndex !== 0) {
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
            && agaGameRooms.length !== 0
            && gameRoomId <= agaGameRooms.length
            && agaGameRooms[gameRoomId] !== undefined
            && agaGameRooms[gameRoomId].players[playerId] !== undefined;
    };


    // aggiunge un riferimento all'utente nel primo slot valido.
    // Ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente.
    // L'eventuale callback passato viene eseguito non appena le gameRoom vengono aggiornate
    module.exports.addUserToGameRoom = function(args) {
        let responseValue;

        // caso nuova partita
        if (args.fromInvitation === undefined || !args.fromInvitation)
            responseValue = addOrganizerPlayer(args.dateValue);
        else
            responseValue = addInvitedPlayer(args.invitationCode);

        callbacks.onGameRoomsUpdated();
        return responseValue;
    };


    let addOrganizerPlayer = function(dateValue) {
        let newPlayerGameRoom = undefined;

        // ci sono delle game rooms: stabilisci se ce ne sono di libere
        for (let gRoomIndex = 0; gRoomIndex < agaGameRooms.length; gRoomIndex++) {
            if (agaGameRooms[gRoomIndex].state === gameRoomStates.free) {
                // c'è una gameRoom libera: allestiscila per la partita
                newPlayerGameRoom = gRoomIndex;
            }
        }

        // non c'è una game room libera: crea una nuova gameRoom
        if (newPlayerGameRoom === undefined) {
            agaGameRooms.push(generateFreeGameRoom());
            newPlayerGameRoom = agaGameRooms.length - 1;
        }

        // occupa il primo slot della gameRoom risultante dalla ricerca
        agaGameRooms[newPlayerGameRoom].date  = dateValue;
        agaGameRooms[newPlayerGameRoom].state = gameRoomStates.mmaking;
        agaGameRooms[newPlayerGameRoom].players.push(generateOccupiedSlot(newPlayerGameRoom, 0));

        return { gameRoomId: newPlayerGameRoom,
                 playerId: 0,
                 code: agaGameRooms[newPlayerGameRoom].code,
                 state: gameRoomStates.mmaking,
                 date: agaGameRooms[newPlayerGameRoom].date };
    };


    let addInvitedPlayer = function(invitationCode) {
        // si è stati invitati: cerca la gameRoom che ha proposto la partita
        let newPlayerData = undefined;
        for (let gRoomIndex = 0; gRoomIndex < agaGameRooms.length; gRoomIndex++) {
            if (agaGameRooms[gRoomIndex].code.toString() === invitationCode.toString()
                && agaGameRooms[gRoomIndex].state === gameRoomStates.mmaking) {

                for (let playerIndex = 0; playerIndex < agaGameRooms[gRoomIndex].players.length; playerIndex++) {
                    // game room trovata: se ci sono slot liberi, occupane uno
                    if (!agaGameRooms[gRoomIndex].players[playerIndex].occupiedSlot) {
                        newPlayerData = { playerId:   playerIndex,
                                          gameRoomId: gRoomIndex };
                    }
                }

                // la game room non ha player slot liberi: creane uno nuovo
                if (newPlayerData === undefined) {
                    agaGameRooms[gRoomIndex].players.push(generateFreeSlot());
                    newPlayerData = { playerId:   agaGameRooms[gRoomIndex].players.length - 1,
                                      gameRoomId: gRoomIndex };
                }
            }
        }

        if (newPlayerData !== undefined) {
            // è stato trovato uno slot valido: occupalo
            agaGameRooms[newPlayerData.gameRoomId].players[newPlayerData.playerId]
                = generateOccupiedSlot(newPlayerData.gameRoomId, newPlayerData.playerId);

            return { gameRoomId: newPlayerData.gameRoomId,
                     playerId:   newPlayerData.playerId,
                     state:      agaGameRooms[newPlayerData.gameRoomId].state,
                     code:       agaGameRooms[newPlayerData.gameRoomId].code,
                     date:       agaGameRooms[newPlayerData.gameRoomId].date }
        }
    };


    // rimuove un utente dalla propria gameRoom
    module.exports.removeUserFromGameRoom = function(gameRoomId, playerId) {
        if (module.exports.isPlayerDataValid(gameRoomId, playerId)) {
            // pulisci lo slot giocatore
            clearTimeout(agaGameRooms[gameRoomId].players[playerId].heartBeatTimer);
            agaGameRooms[gameRoomId].players[playerId] = generateFreeSlot();

            // rimuovi se presenti le gli slot lbieri consecutivi in fondo all'array
            for (let playerIndex = agaGameRooms[gameRoomId].players.length - 1; playerIndex >= 0; playerIndex--) {
                if (!agaGameRooms[gameRoomId].players[playerIndex].occupiedSlot)
                    agaGameRooms[gameRoomId].players.splice(playerIndex, 1);
                else
                    break;
            }

            // pulisci la game room se necessario
            if (agaGameRooms[gameRoomId].state === gameRoomStates.playing) {
                let noPlayers = true;
                for (let playerIndex = 0; playerIndex < agaGameRooms[gameRoomId].players.length; playerIndex++) {
                    if (agaGameRooms[gameRoomId].players[playerIndex].occupiedSlot)
                        noPlayers = false;
                }

                if (noPlayers)
                    agaGameRooms[gameRoomId] = generateFreeGameRoom();
            }

            // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
            for (let gRoomIndex = agaGameRooms.length - 1; gRoomIndex >= 0; gRoomIndex--) {
                if (agaGameRooms[gRoomIndex].state === gameRoomStates.free)
                    agaGameRooms.splice(gRoomIndex, 1);
                else
                    break;
            }

            callbacks.onGameRoomsUpdated();
        }
    };


    // aggiorna il timer heartbeat di un giocatore. invocato all'arrivo di un messaggio di heartbeat
    module.exports.updateHeartBeat = function(gameRoomId, playerId) {
        if (module.exports.isPlayerDataValid(gameRoomId, playerId)) {
            clearTimeout(agaGameRooms[gameRoomId].players[playerId].heartBeatTimer);
            agaGameRooms[gameRoomId].players[playerId].heartBeatTimer = generateHeartbeatTimer(gameRoomId, playerId);
        }
    };

    module.exports.startMatch = function(gameRoomId) {
        agaGameRooms[gameRoomId].state = gameRoomStates.playing;
    };


    let generateFreeGameRoom = function(dateValue) {
      return { players: [], state: gameRoomStates.free, date: dateValue, code: generateUniqueCode() };
    };


    // crea uno slot libero da porre su una gameRoom
    let generateFreeSlot = function() {
        return { occupiedSlot: false, heartBeatTimer: undefined };
    };


    // setta uno slot come occupato, aggiornando la variabile di occupazione e settando un
    // nuovo timer per gestire l'heartbeat
    let generateOccupiedSlot = function(gameRoomId, playerId) {
        return { occupiedSlot: true, heartBeatTimer: generateHeartbeatTimer(gameRoomId, playerId) };
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
            for (let i = 0; i < agaGameRooms.length; i++) {
                if (newCode === agaGameRooms[i].code)
                    unique = false;
            }
        } while (!unique);

        return newCode;
    };
}());