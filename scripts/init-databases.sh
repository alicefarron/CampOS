#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE campost_registrations;
  CREATE DATABASE campost_news;
  CREATE DATABASE campost_notifications;
EOSQL
