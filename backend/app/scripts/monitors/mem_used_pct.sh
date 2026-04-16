# @label Memory Used (%)
# @unit %
free | awk '/^Mem:/{printf "%.1f", $3/$2*100}'
