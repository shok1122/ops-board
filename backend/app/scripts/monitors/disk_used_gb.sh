# @label Disk Used
# @unit GB
# @configurable true
# @config_field key=path label="Mount path" default=/
df -BG {path} | awk 'NR==2{gsub(/G/,""); print $3}'
