df -BG {path} | awk 'NR==2{gsub(/G/,""); print $3}'
