# @label CPU Load
# @unit
# @configurable true
# @config_field key=interval label="計測間隔" type=select default=1m
# @config_option interval 1m 1分 awk_field=$1
# @config_option interval 5m 5分 awk_field=$2
# @config_option interval 15m 15分 awk_field=$3
awk '{print {awk_field}}' /proc/loadavg
