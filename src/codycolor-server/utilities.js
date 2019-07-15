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


    module.exports.requiredClientVersion  = '2.1.0';


    module.exports.gameTypes = {
        custom: 'custom',
        random: 'random',
        royale: 'royale'
    };


    module.exports.gameRoomStates = {
        mmaking: 'mmaking',
        playing: 'playing',
        aftermatch: 'aftermatch',
        free:    'free'
    };
    

    module.exports.messageTypes = {
        c_connectedSignal:  "c_connectedSignal",
        s_generalInfo:      "s_generalInfo",   //

        c_gameRequest:    "c_gameRequest",    // client richiede di giocare
        s_gameResponse:   "s_gameResponse",   // server fornisce credenziali di gioco

        c_playerQuit:     "c_playerQuit",     // richiesta di fine gioco di un client
        s_gameQuit:       "s_gameQuit",       // forza il fine gioco per tutti

        s_playerAdded:    "s_playerAdded",    // notifica un giocatore si collega
        s_playerRemoved:  "s_playerRemoved",  // notifica un giocatore si scollega

        c_validation:     "c_validation",     // rende l'iscrizione del giocatore 'valida' fornendo credenz. come il nick
        c_ready:          "c_ready",          // segnale pronto a giocare; viene intercettato anche dai client
        s_startMatch:     "s_startMatch",     // segnale avvia partita

        c_positioned:     "c_positioned",     // segnale giocatore posizionato
        s_timerSync:      "s_timerSync",      // re-rincronizza i timer ogni 5 secondi
        s_startAnimation: "s_startAnimation", // inviato quando tutti sono posizionati
        c_endAnimation:   "c_endAnimation",   // notifica la fine dell'animazione, o lo skip
        s_endMatch:       "s_endMatch",       // segnale aftermatch

        c_heartbeat:      "c_heartbeat",      // segnale heartbeat
        c_chat:           "c_chat",           // chat, intercettati SOLO dai client
    };


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


    // funzione che imita il jQuery $.extend, utilizzato in questo programma per
    // effettuare deep copy in un oggetto. Fonte:
    // https://stackoverflow.com/questions/9399365/deep-extend-like-jquerys-for-nodejs
    module.exports.extend = function() {
        var options, name, src, copy, copyIsArray, clone, target = arguments[0] || {},
        i = 1,
        length = arguments.length,
        deep = false,
        toString = Object.prototype.toString,
        hasOwn = Object.prototype.hasOwnProperty,
        push = Array.prototype.push,
        slice = Array.prototype.slice,
        trim = String.prototype.trim,
        indexOf = Array.prototype.indexOf,
        class2type = {
            "[object Boolean]": "boolean",
            "[object Number]": "number",
            "[object String]": "string",
            "[object Function]": "function",
            "[object Array]": "array",
            "[object Date]": "date",
            "[object RegExp]": "regexp",
            "[object Object]": "object"
        },
        jQuery = {
            isFunction: function (obj) {
                return jQuery.type(obj) === "function"
            },
            isArray: Array.isArray ||
                function (obj) {
                    return jQuery.type(obj) === "array"
                },
            isWindow: function (obj) {
                return obj != null && obj == obj.window
            },
            isNumeric: function (obj) {
                return !isNaN(parseFloat(obj)) && isFinite(obj)
            },
            type: function (obj) {
                return obj == null ? String(obj) : class2type[toString.call(obj)] || "object"
            },
            isPlainObject: function (obj) {
                if (!obj || jQuery.type(obj) !== "object" || obj.nodeType) {
                    return false
                }
                try {
                    if (obj.constructor && !hasOwn.call(obj, "constructor") && !hasOwn.call(obj.constructor.prototype, "isPrototypeOf")) {
                        return false
                    }
                } catch (e) {
                    return false
                }
                var key;
                for (key in obj) {}
                return key === undefined || hasOwn.call(obj, key)
            }
        };
    if (typeof target === "boolean") {
        deep = target;
        target = arguments[1] || {};
        i = 2;
    }
    if (typeof target !== "object" && !jQuery.isFunction(target)) {
        target = {}
    }
    if (length === i) {
        target = this;
        --i;
    }
    for (i; i < length; i++) {
        if ((options = arguments[i]) != null) {
            for (name in options) {
                src = target[name];
                copy = options[name];
                if (target === copy) {
                    continue
                }
                if (deep && copy && (jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)))) {
                    if (copyIsArray) {
                        copyIsArray = false;
                        clone = src && jQuery.isArray(src) ? src : []
                    } else {
                        clone = src && jQuery.isPlainObject(src) ? src : {};
                    }
                    // WARNING: RECURSION
                    target[name] = extend(deep, clone, copy);
                } else if (copy !== undefined) {
                    target[name] = copy;
                }
            }
        }
    }
    return target;
    };
}());