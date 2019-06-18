FROM alpine:3.8
RUN apk add --no-cache mysql-client

WORKDIR /app
COPY client.sh /app/client.sh
RUN chmod +x client.sh
COPY *.sql /app/

CMD ["true"]
