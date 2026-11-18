import re
src=open('src/src.html').read()
syl=open('src/syl.js').read().replace('if (typeof module !== "undefined") module.exports = sylSplit;','')
audio=open('src/audio.js').read()
play=open('src/play.js').read()
out=src.replace('/*SYL*/',syl).replace('  /*AUDIO*/',audio).replace('  /*PLAY*/',play)
open('index.html','w').write(out)
