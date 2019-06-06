/*
 * customGameRooms.js: file per la gestione dell'array gameRoom ad accoppiamento personalizzato dei giocatori. Espone metodi
 * per l'aggiunta e la rimozione dei giocatori, oltre a metodi per recuperare informazioni sullo stato delle game room.
 */
(function () {
    let utilities = require("./utilities");
    let royaleGameRooms = [];
    let callbacks = {};
    const gameRoomStates = utilities.gameRoomStates;


    // inizializza i callbacks utilizzati dal modulo
    module.exports.setCallbacks = function(onGameRoomsUpdated, onHeartbeatExpired, onStartTimerExpired) {
        callbacks.onGameRoomsUpdated = onGameRoomsUpdated;
        callbacks.onHeartbeatExpired = onHeartbeatExpired;
        callbacks.onStartTimerExpired = onStartTimerExpired;
    };


    // fornisce il conteggio complessivo dei giocatori attivi sulle game room ad accoppiamento casuale
    module.exports.getConnectedPlayers = function() {
        let connectedPlayers = 0;
        for (let gameRoomIndex = 0; gameRoomIndex < royaleGameRooms.length; gameRoomIndex++) {
            for (let playerIndex = 0; playerIndex < royaleGameRooms[gameRoomIndex].players.length; playerIndex++)
                if (royaleGameRooms[gameRoomIndex].players[playerIndex].occupiedSlot)
                    connectedPlayers++;
        }
        return connectedPlayers;
    };


    // stampa a console le gameRoom attive ad accoppiamento personalizzato
    module.exports.printGameRooms = function() {
        utilities.printLog(false, 'New royale game room configuration:');

        if (royaleGameRooms.length <= 0) {
            utilities.printLog(false, 'empty');

        } else {
            let gameRoomString = '';
            for (let gameRoomIndex = 0; gameRoomIndex < royaleGameRooms.length; gameRoomIndex++) {
                gameRoomString = gameRoomIndex.toString() + '[';
                for (let playerIndex = 0; playerIndex < royaleGameRooms[gameRoomIndex].players.length; playerIndex++) {
                   gameRoomString += (royaleGameRooms[gameRoomIndex].players[playerIndex].occupiedSlot ? 'x' : 'o');
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
            && royaleGameRooms.length !== 0
            && gameRoomId <= royaleGameRooms.length
            && royaleGameRooms[gameRoomId] !== undefined
            && royaleGameRooms[gameRoomId].players[playerId] !== undefined;
    };


    // aggiunge un riferimento all'utente nel primo slot valido.
    // Ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente.
    // L'eventuale callback passato viene eseguito non appena le gameRoom vengono aggiornate
    module.exports.addUserToGameRoom = function(args) {
        let responseValue;

        // caso nuova partita
        if (args.fromInvitation === undefined || !args.fromInvitation)
            responseValue = addOrganizerPlayer(args.dateValue, args.timerSetting, args.gameName);
        else
            responseValue = addInvitedPlayer(args.invitationCode);

        callbacks.onGameRoomsUpdated();
        return responseValue;
    };


    let addOrganizerPlayer = function(dateValue, timerSettingValue, gameNameValue) {
        let newPlayerGameRoom = undefined;

        // ci sono delle game rooms: stabilisci se ce ne sono di libere
        for (let gRoomIndex = 0; gRoomIndex < royaleGameRooms.length; gRoomIndex++) {
            if (royaleGameRooms[gRoomIndex].state === gameRoomStates.free) {
                // c'è una gameRoom libera: allestiscila per la partita
                newPlayerGameRoom = gRoomIndex;
            }
        }

        // non c'è una game room libera: crea una nuova gameRoom
        if (newPlayerGameRoom === undefined) {
            royaleGameRooms.push(generateFreeGameRoom());
            newPlayerGameRoom = royaleGameRooms.length - 1;
        }

        // occupa il primo slot della gameRoom risultante dalla ricerca
        royaleGameRooms[newPlayerGameRoom].date  = dateValue;
        royaleGameRooms[newPlayerGameRoom].timerSetting  = timerSettingValue;
        royaleGameRooms[newPlayerGameRoom].state = gameRoomStates.mmaking;
        royaleGameRooms[newPlayerGameRoom].gameName = gameNameValue;
        royaleGameRooms[newPlayerGameRoom].players.push(generateOccupiedSlot(newPlayerGameRoom, 0));

        // avvia un timer che farà avviare la partita non appena scoccherà la data della battle
        if (dateValue !== undefined) {
            setTimeout(function() { callbacks.onStartTimerExpired(newPlayerGameRoom); },
                dateValue - (new Date()).getTime());
        }

        return {
            gameRoomId: newPlayerGameRoom,
            playerId: 0,
            gameName: royaleGameRooms[newPlayerGameRoom].gameName,
            timerSetting: timerSettingValue,
            code: royaleGameRooms[newPlayerGameRoom].code,
            state: gameRoomStates.mmaking,
            date: royaleGameRooms[newPlayerGameRoom].date
        };
    };


    let addInvitedPlayer = function(invitationCode) {
        // si è stati invitati: cerca la gameRoom che ha proposto la partita
        let newPlayerData = undefined;
        for (let gRoomIndex = 0; gRoomIndex < royaleGameRooms.length; gRoomIndex++) {
            if (royaleGameRooms[gRoomIndex].code.toString() === invitationCode.toString()
                && royaleGameRooms[gRoomIndex].state === gameRoomStates.mmaking
                && royaleGameRooms[gRoomIndex].players.length < 20) {

                for (let playerIndex = 0; playerIndex < royaleGameRooms[gRoomIndex].players.length; playerIndex++) {
                    // game room trovata: se ci sono slot liberi, occupane uno
                    if (!royaleGameRooms[gRoomIndex].players[playerIndex].occupiedSlot) {
                        newPlayerData = {
                            playerId:   playerIndex,
                            gameRoomId: gRoomIndex
                        };
                    }
                }

                // la game room non ha player slot liberi: creane uno nuovo
                if (newPlayerData === undefined) {
                    royaleGameRooms[gRoomIndex].players.push(generateFreeSlot());
                    newPlayerData = {
                        playerId:   royaleGameRooms[gRoomIndex].players.length - 1,
                        gameRoomId: gRoomIndex
                    };
                }
            }
        }

        if (newPlayerData !== undefined) {
            // è stato trovato uno slot valido: occupalo
            royaleGameRooms[newPlayerData.gameRoomId].players[newPlayerData.playerId]
                = generateOccupiedSlot(newPlayerData.gameRoomId, newPlayerData.playerId);

            return {
                gameRoomId:   newPlayerData.gameRoomId,
                playerId:     newPlayerData.playerId,
                state:        royaleGameRooms[newPlayerData.gameRoomId].state,
                code:         royaleGameRooms[newPlayerData.gameRoomId].code,
                timerSetting: royaleGameRooms[newPlayerData.gameRoomId].timerSetting,
                date:         royaleGameRooms[newPlayerData.gameRoomId].date
            };
        }
    };


    // rimuove un utente dalla propria gameRoom
    module.exports.removeUserFromGameRoom = function(gameRoomId, playerId) {
        if (module.exports.isPlayerDataValid(gameRoomId, playerId)) {
            let forceRemove = gameRoomId === 0 && royaleGameRooms[gameRoomId].date === undefined;

            // pulisci lo slot giocatore
            clearTimeout(royaleGameRooms[gameRoomId].players[playerId].heartBeatTimer);
            royaleGameRooms[gameRoomId].players[playerId] = generateFreeSlot();

            // rimuovi se presenti le gli slot liberi consecutivi in fondo all'array
            for (let playerIndex = royaleGameRooms[gameRoomId].players.length - 1; playerIndex >= 0; playerIndex--) {
                if (!royaleGameRooms[gameRoomId].players[playerIndex].occupiedSlot)
                    royaleGameRooms[gameRoomId].players.splice(playerIndex, 1);
                else
                    break;
            }

            cleanGameRoom(gameRoomId);
            callbacks.onGameRoomsUpdated();
            return forceRemove;
        }
    };


    // aggiorna il timer heartbeat di un giocatore. invocato all'arrivo di un messaggio di heartbeat
    module.exports.updateHeartBeat = function(gameRoomId, playerId) {
        if (module.exports.isPlayerDataValid(gameRoomId, playerId)) {
            clearTimeout(royaleGameRooms[gameRoomId].players[playerId].heartBeatTimer);
            royaleGameRooms[gameRoomId].players[playerId].heartBeatTimer = generateHeartbeatTimer(gameRoomId, playerId);
        }
    };


    module.exports.startMatch = function(gameRoomId) {
        royaleGameRooms[gameRoomId].state = gameRoomStates.playing;
        cleanGameRoom(gameRoomId);
    };


    let cleanGameRoom = function(gameRoomId) {
        // pulisci la game room se necessario
        let noPlayers = true;
        for (let playerIndex = 0; playerIndex < royaleGameRooms[gameRoomId].players.length; playerIndex++) {
            if (royaleGameRooms[gameRoomId].players[playerIndex].occupiedSlot)
                noPlayers = false;
        }

        if ((noPlayers && royaleGameRooms[gameRoomId].state === gameRoomStates.playing)
            || (noPlayers && royaleGameRooms[gameRoomId].date === undefined)){
            royaleGameRooms[gameRoomId] = generateFreeGameRoom();
        }

        // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
        for (let gRoomIndex = royaleGameRooms.length - 1; gRoomIndex >= 0; gRoomIndex--) {
            if (royaleGameRooms[gRoomIndex].state === gameRoomStates.free)
                royaleGameRooms.splice(gRoomIndex, 1);
            else
                break;
        }
    };


    let generateFreeGameRoom = function(dateValue) {
      return {
          players: [],
          state: gameRoomStates.free,
          date: dateValue,
          code: generateUniqueCode(),
          timerSetting: undefined
      };
    };


    // crea uno slot libero da porre su una gameRoom
    let generateFreeSlot = function() {
        return {
            occupiedSlot: false,
            heartBeatTimer: undefined
        };
    };


    // setta uno slot come occupato, aggiornando la variabile di occupazione e settando un
    // nuovo timer per gestire l'heartbeat
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
            for (let i = 0; i < royaleGameRooms.length; i++) {
                if (newCode === royaleGameRooms[i].code)
                    unique = false;
            }
        } while (!unique);

        return newCode;
    };
}());