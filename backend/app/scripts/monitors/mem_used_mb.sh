# @label Memory Used (MB)
# @unit MB
free | awk '/^Mem:/{print $3}'
