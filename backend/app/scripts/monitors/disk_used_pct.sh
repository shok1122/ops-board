# @label Disk Usage
# @unit %
# @configurable true
# @config_field key=path label="Mount path" default=/
df {path} | awk 'NR==2{print $5}' | tr -d '%'
