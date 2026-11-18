// Silbentrennung (Heuristik für Deutsch/Englisch) – wird in index.html eingebettet
function sylSplit(word, lang) {
  const VOW = "aeiouyäöüàáâéèêíìîóòôúùû";
  const DIPH_DE = ["ai","au","ei","eu","äu","ie","aa","ee","oo","ey","ay","ou"];
  const DIPH_EN = ["ai","au","ay","ea","ee","ei","ey","ie","oa","oe","oi","oo","ou","ow","oy","ue","ui","ew","aw"];
  const diph = lang === "en" ? DIPH_EN : DIPH_DE;
  const lw = word.toLowerCase();
  const isV = (i) => {
    const ch = lw[i];
    if (!VOW.includes(ch)) return false;
    if (ch === "y") { const nx = lw[i + 1]; return i > 0 && !(nx && "aeiouäöü".includes(nx)); }  // y am Wortanfang/vor Vokal = Konsonant
    if (ch === "u" && i > 0 && lw[i - 1] === "q") return false;                     // qu
    return true;
  };
  const groups = [];
  for (let i = 0; i < lw.length;) {
    if (isV(i)) {
      let j = i + 1;
      if (j < lw.length && isV(j) && diph.includes(lw[i] + lw[j])) j++;
      // englisch: w/ y nach Vokal gehören zum Vokal (ow, ay …) – schon über diph abgedeckt
      groups.push([i, j]); i = j;
    } else i++;
  }
  if (lang === "en" && groups.length > 1) {
    const last = groups[groups.length - 1], prev = groups[groups.length - 2];
    const tail = lw.slice(last[0]);
    const tailClean = tail.replace(/[^a-z]/g, "");
    const consBefore = lw.slice(prev[1], last[0]);
    // stummes e: "time", "times", "loved" (aber nicht "table", "wanted", "the")
    if ((tailClean === "e" || tailClean === "es" || tailClean === "ed") && consBefore.length >= 1) {
      const isLe = tailClean === "e" && consBefore.length >= 2 && consBefore.endsWith("l");
      const isTed = tailClean === "ed" && /[td]$/.test(consBefore);
      const isSes = tailClean === "es" && /(s|x|z|ch|sh|ce|ge)$/.test(consBefore);
      if (!isLe && !isTed && !isSes) groups.pop();
    }
  }
  if (groups.length <= 1) return [word];
  const CLUSTER3 = ["sch"];
  const CLUSTER2 = lang === "en"
    ? ["ch","ck","ph","th","sh","wh","gh","qu","bl","br","cl","cr","dr","fl","fr","gl","gr","pl","pr","tr","sc","sk","sp","st","sw"]
    : ["ch","ck","ph","th","qu"];
  const cuts = [];
  for (let k = 0; k < groups.length - 1; k++) {
    const a = groups[k][1], b = groups[k + 1][0];
    const cons = lw.slice(a, b);
    let take = 1;
    if (cons.length === 0) take = 0;
    else if (CLUSTER3.some(c => cons.endsWith(c)) && cons.length >= 3) take = 3;
    else if (cons.length >= 2 && CLUSTER2.some(c => cons.endsWith(c))) take = 2;
    const ONSET_DE = ["schl","schr","schw","spr","str","bl","br","pl","pr","kl","kr","gl","gr","fl","fr","dr","tr","sp","st","zw"];
    if (lang !== "en" && cons.length >= 3) { const o = ONSET_DE.find(x => cons.endsWith(x) && cons.length > x.length); if (o) take = o.length; }
    if (lang === "en" && cons.length >= 2 && cons.endsWith("l") && k === groups.length - 2 && lw.slice(b).replace(/[^a-z]/g, "") === "e") take = 2;
    cuts.push(Math.max(a, b - take));
  }
  const out = []; let s = 0;
  cuts.forEach(c => { if (c > s) { out.push(word.slice(s, c)); s = c; } });
  out.push(word.slice(s));
  return out.filter(Boolean);
}
if (typeof module !== "undefined") module.exports = sylSplit;
