# @label SSL Cert Expiry
# @unit 日
# @configurable true
# @config_field key=port label="HTTPS port" default=443
echo | openssl s_client -connect {host}:{port} -servername {host} 2>/dev/null | openssl x509 -noout -enddate | awk -F= '{cmd="date -d \""$2"\" +%s"; cmd | getline exp; close(cmd); print int((exp-systime())/86400)}'
