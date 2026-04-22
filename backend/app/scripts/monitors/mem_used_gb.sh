# @label Memory Used (GB)
# @unit GB
free | awk '/^Mem:/{printf "%.2f\n", $3/(1000*1000)}'