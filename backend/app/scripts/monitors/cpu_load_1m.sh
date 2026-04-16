# @label CPU Load (1m)
# @unit
# @hidden true
awk '{print $1}' /proc/loadavg
