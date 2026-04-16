#!/bin/bash
# @label SSL Cert Expiry
# @unit %
# @configurable true
# @config_field key=port label="HTTPS port" default=443

ssl_output=$(echo | openssl s_client -connect www.ssn.nitech.ac.jp:443 2>/dev/null | openssl x509 -noout -startdate -enddate)
start_date=$(echo "$ssl_output" | grep notBefore | cut -d= -f2-)
end_date=$(echo "$ssl_output"   | grep notAfter  | cut -d= -f2-)

echo "Start date: $start_date"
echo "End date: $end_date"

start_exp=$(date -d "$start_date" +%s)
end_exp=$(date -d "$end_date" +%s)
now=$(date +%s)

echo $(( ((now - start_exp) * 100) / (end_exp - start_exp) ))
