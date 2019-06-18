#! /bin/sh
if [ -z "$1" ]
    then
        mysql -h database -u ${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE}
else
    mysql -h database -u ${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} < $1
fi
