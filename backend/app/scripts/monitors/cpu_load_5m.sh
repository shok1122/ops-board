# @label CPU Load (5m)
# @unit
# @hidden true
awk '{print $2}' /proc/loadavg
