tmux new-session -d -s tv_modes \; \
  split-window -h \; split-window -v \; select-pane -t 0 \; split-window -v \; \
  select-layout tiled \; \
  send-keys -t 0 'cd /Users/developer/Documents/algos/personal/earner/upstox_trader && python 
  screeners/tv_screen_usage.py --watch --mode MOMENTUM --refresh 15 --enable-trading' C-m \; \
  send-keys -t 1 'cd /Users/developer/Documents/algos/personal/earner/upstox_trader && python 
  screeners/tv_screen_usage.py --watch --mode ACCUMULATION --refresh 15 --enable-trading' C-m \; \
  send-keys -t 2 'cd /Users/developer/Documents/algos/personal/earner/upstox_trader && python 
  screeners/tv_screen_usage.py --watch --mode PREBREAKOUT --refresh 15 --enable-trading' C-m \; \
  send-keys -t 3 'cd /Users/developer/Documents/algos/personal/earner/upstox_trader && python 
  screeners/tv_screen_usage.py --watch --mode OPTIMIZED_GAP --refresh 15 --enable-trading' C-m \; \
  attach-session -t tv_modes
