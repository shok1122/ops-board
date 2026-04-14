free | awk '/^Mem:/{printf "%.1f", $3/$2*100}'
