# @label CPU Load (15m)
# @unit
# @hidden true
awk '{print $3}' /proc/loadavg
