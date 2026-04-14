df {path} | awk 'NR==2{print $5}' | tr -d '%'
