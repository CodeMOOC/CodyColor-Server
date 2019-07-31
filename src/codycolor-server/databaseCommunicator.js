/*
 * databaseCommunicator.js: fornisce utilities per la connessione al db
 */
(function () {
    const mysql = require('mysql');
    const utilities = require("./utilities");

    const connection = mysql.createConnection({
        host: 'database',
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        multipleStatements: true // possono essere effettuate query multiple.
    });
    connection.connect();

    module.exports.query = function(query, handleResults) {
        connection.query(query, (error, results, fields) => {
            if (error)
                utilities.printLog(false, "Error querying the DB. " + error.toString());
            else
                utilities.printLog(false, "DB queried with success.");

            if (handleResults !== undefined)
                handleResults(results, error)
        });
    };

    module.exports.sanitize = function (value) {
        return connection.escape(value);
    }
}());