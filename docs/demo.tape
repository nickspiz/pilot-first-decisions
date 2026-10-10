# Same demo as demo.gif, for charmbracelet/vhs:  vhs docs/demo.tape
# (docs/render_demo.py draws the committed GIF without needing vhs.)
# Run from the repo root. Fixture mode: no network, no API key, no cost.
Output docs/demo.gif
Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 780
Set Padding 20
Set TypingSpeed 30ms
Set Theme "Dracula"
Hide
Type "PS1='$ ' && unset OPENROUTER_API_KEY && clear"
Enter
Show
Type "node bench.mjs --fixture examples/fixture.json --data examples/support-messages.jsonl --questions examples/questions.json --confidence-threshold 0.8 --limit 60 | head -26"
Enter
Sleep 8s
