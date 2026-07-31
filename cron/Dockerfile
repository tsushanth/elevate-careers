FROM alpine:3.19
RUN apk add --no-cache curl bash jq
COPY cron/ingest.sh /ingest.sh
RUN chmod +x /ingest.sh
CMD ["/ingest.sh"]
