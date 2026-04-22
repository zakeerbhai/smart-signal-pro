"""
Smart Signal Pro — FINAL VERSION
Real forex data: Alpha Vantage (QDPMSJTAE3WVURK3)
OTC pairs: seeded simulation (stable per 5-min window)
12 indicators, min 4 confirmations required
"""
from flask import Flask, render_template, jsonify, request
import sqlite3, math, random, time, json
from datetime import datetime
try:
    import urllib.request as urlreq
except:
    urlreq = None

app = Flask(__name__)
DB = "signals.db"

AV_KEY = "QDPMSJTAE3WVURK3"

FOREX  = ["EUR/USD","GBP/USD","USD/JPY","AUD/USD","USD/CHF","NZD/USD","EUR/GBP","USD/CAD"]
CRYPTO = ["BTC/USD","ETH/USD","XRP/USD"]
OTC    = ["EUR/USD-OTC","GBP/USD-OTC","AUD/USD-OTC","USD/JPY-OTC"]
ALL_ASSETS = FOREX + CRYPTO + OTC

BASE = {
    "EUR/USD":1.0852,"GBP/USD":1.2654,"USD/JPY":149.48,"AUD/USD":0.6582,
    "USD/CHF":0.9018,"NZD/USD":0.6081,"EUR/GBP":0.8577,"USD/CAD":1.3645,
    "BTC/USD":67420.0,"ETH/USD":3388.0,"XRP/USD":0.5815,
    "EUR/USD-OTC":1.0851,"GBP/USD-OTC":1.2653,"AUD/USD-OTC":0.6581,"USD/JPY-OTC":149.47,
}

def init_db():
    con=sqlite3.connect(DB); c=con.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS signals(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset TEXT,signal TEXT,strength INTEGER,timeframe TEXT,
        risk TEXT,confirmations INTEGER,price REAL,
        indicators TEXT,conf_list TEXT,timestamp TEXT,result TEXT DEFAULT 'PENDING')""")
    c.execute("""CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT)""")
    for k,v in [("rsi_os","30"),("rsi_ob","70"),("min_conf","4"),("risk_lo","60"),("risk_me","75")]:
        c.execute("INSERT OR IGNORE INTO settings VALUES(?,?)",(k,v))
    con.commit(); con.close()

def get_cfg():
    con=sqlite3.connect(DB); c=con.cursor()
    c.execute("SELECT key,value FROM settings")
    s={r[0]:r[1] for r in c.fetchall()}; con.close(); return s

_cache={}
def get_candles(asset,tf="5m"):
    key=f"{asset}_{tf}"; now=time.time()
    if key in _cache and now-_cache[key][0]<270:
        return _cache[key][1]
    ivmap={"1m":"1min","5m":"5min","15m":"15min","30m":"30min"}
    iv=ivmap.get(tf,"5min")
    candles=None
    if urlreq and not asset.endswith("-OTC"):
        try:
            if asset in CRYPTO:
                sym=asset.split("/")[0]
                url=f"https://www.alphavantage.co/query?function=CRYPTO_INTRADAY&symbol={sym}&market=USD&interval={iv}&outputsize=compact&apikey={AV_KEY}"
                with urlreq.urlopen(url,timeout=8) as r: data=json.loads(r.read())
                ts_key=f"Time Series Crypto ({iv})"
                if ts_key in data:
                    series=data[ts_key]
                    candles=[{"open":float(v["1. open"]),"high":float(v["2. high"]),
                               "low":float(v["3. low"]),"close":float(v["4. close"]),
                               "volume":int(float(v.get("5. volume",1000))),"live":True}
                              for _,v in sorted(series.items())][-100:]
            else:
                f,t=asset.split("/")
                url=f"https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol={f}&to_symbol={t}&interval={iv}&outputsize=compact&apikey={AV_KEY}"
                with urlreq.urlopen(url,timeout=8) as r: data=json.loads(r.read())
                ts_key=f"Time Series FX ({iv})"
                if ts_key in data:
                    series=data[ts_key]
                    candles=[{"open":float(v["1. open"]),"high":float(v["2. high"]),
                               "low":float(v["3. low"]),"close":float(v["4. close"]),
                               "volume":1000,"live":True}
                              for _,v in sorted(series.items())][-100:]
        except: candles=None
    if not candles or len(candles)<20:
        candles=sim(asset)
    _cache[key]=(now,candles); return candles

def sim(asset,n=100):
    w=int(time.time()/300); seed=(w*7919+sum(ord(x) for x in asset))&0xFFFFFF
    random.seed(seed); p=BASE.get(asset,1.0); vol=p*0.00065
    phase=random.choice(["UP","DOWN","SIDE"]); drift=random.uniform(0.0001,0.00035)*p
    out=[]
    for i in range(n):
        if i in(33,66): phase=random.choice(["UP","DOWN","SIDE"])
        d=(drift if phase=="UP" else -drift if phase=="DOWN" else 0)
        mv=d+random.gauss(0,vol); op=p; cl=op+mv
        out.append({"open":round(op,5),"high":round(max(op,cl)+abs(random.gauss(0,vol*.4)),5),
                    "low":round(min(op,cl)-abs(random.gauss(0,vol*.4)),5),
                    "close":round(cl,5),"volume":random.randint(600,4800),"live":False})
        p=cl
    return out

# indicators
def rsi(cl,p=14):
    if len(cl)<p+1: return 50.0
    g=l=0.0
    for i in range(1,p+1):
        d=cl[-i]-cl[-i-1]
        if d>0: g+=d
        else: l-=d
    ag=g/p or 1e-9; al=l/p or 1e-9
    return round(100-(100/(1+ag/al)),2)

def sma(cl,p):
    if len(cl)<p: return cl[-1]
    return round(sum(cl[-p:])/p,6)

def ema(cl,p):
    if len(cl)<p: return cl[-1]
    k=2/(p+1); e=sum(cl[:p])/p
    for c in cl[p:]: e=c*k+e*(1-k)
    return round(e,6)

def macd(cl):
    if len(cl)<35: return 0,0,0
    e12=ema(cl,12); e26=ema(cl,26); ml=e12-e26
    mls=[ema(cl[:-i] if i<len(cl) else cl,12)-ema(cl[:-i] if i<len(cl) else cl,26) for i in range(9,0,-1)]
    sl=ema(mls,9)
    return round(ml,7),round(sl,7),round(ml-sl,7)

def bband(cl,p=20,sd=2):
    if len(cl)<p: return cl[-1],cl[-1],cl[-1]
    m=sma(cl,p); std=math.sqrt(sum((c-m)**2 for c in cl[-p:])/p)
    return round(m+sd*std,6),round(m,6),round(m-sd*std,6)

def stoch(cands,kp=14):
    if len(cands)<kp: return 50.0,50.0
    sl=cands[-kp:]; H=max(c["high"] for c in sl); L=min(c["low"] for c in sl)
    cl=cands[-1]["close"]; k=round((cl-L)/(H-L)*100,2) if H!=L else 50.0
    ks=[]
    for i in range(3):
        sub=cands[-(kp+i):-i or len(cands)]; H2=max(c["high"] for c in sub); L2=min(c["low"] for c in sub)
        cl2=cands[-1-i]["close"]; ks.append((cl2-L2)/(H2-L2)*100 if H2!=L2 else 50)
    return k,round(sum(ks)/3,2)

def haconv(cands):
    if len(cands)<5: return None
    po=(cands[0]["open"]+cands[0]["close"])/2; pc=sum(cands[0][k] for k in["open","high","low","close"])/4
    ha=[]
    for c in cands[-5:]:
        hc=sum(c[k] for k in["open","high","low","close"])/4; ho=(po+pc)/2
        ha.append({"open":ho,"close":hc,"high":max(c["high"],ho,hc),"low":min(c["low"],ho,hc)})
        po,pc=ho,hc
    return ha

def pattern(cands):
    if len(cands)<3: return "None","NEUTRAL"
    c,p,pp=cands[-1],cands[-2],cands[-3]
    body=abs(c["close"]-c["open"]); rng=c["high"]-c["low"] or 1e-9
    uw=c["high"]-max(c["open"],c["close"]); lw=min(c["open"],c["close"])-c["low"]
    if body/rng<0.1: return "Doji","NEUTRAL"
    if lw>body*2 and uw<body*.5 and c["close"]>c["open"]: return "Hammer","BUY"
    if uw>body*2 and lw<body*.5 and c["close"]<c["open"]: return "Shooting Star","SELL"
    if p["close"]<p["open"] and c["close"]>c["open"] and c["open"]<=p["close"] and c["close"]>=p["open"]: return "Bullish Engulfing","BUY"
    if p["close"]>p["open"] and c["close"]<c["open"] and c["open"]>=p["close"] and c["close"]<=p["open"]: return "Bearish Engulfing","SELL"
    if body/rng>0.85 and c["close"]>c["open"]: return "Bull Marubozu","BUY"
    if body/rng>0.85 and c["close"]<c["open"]: return "Bear Marubozu","SELL"
    return "None","NEUTRAL"

def trenddir(cl):
    if len(cl)<30: return "SIDEWAYS",0
    e10=ema(cl,10); e30=ema(cl,30); d=(e10-e30)/e30*100
    if d>0.05: return "UPTREND",round(min(abs(d)*80,100),1)
    if d<-0.05: return "DOWNTREND",round(min(abs(d)*80,100),1)
    return "SIDEWAYS",round(abs(d)*80,1)

def gen_signal(asset,tf,cfg):
    cands=get_candles(asset,tf); cl=[c["close"] for c in cands]
    ros=float(cfg.get("rsi_os",30)); rob=float(cfg.get("rsi_ob",70))
    rv=rsi(cl); s20=sma(cl,20); s50=sma(cl,50); e9=ema(cl,9); e21=ema(cl,21)
    ml,slv,hist=macd(cl); bbu,bbm,bbl=bband(cl); sk,sd=stoch(cands)
    sup=round(min(c["low"] for c in cands[-25:]),6); res=round(max(c["high"] for c in cands[-25:]),6)
    pat_n,pat_s=pattern(cands); ha=haconv(cands); td,ts=trenddir(cl)
    avg_vol=sum(c["volume"] for c in cands[-10:])/10; vc=cands[-1]["volume"]>avg_vol*1.15
    mom=round((cl[-1]-cl[-11])/cl[-11]*100,4) if len(cl)>11 else 0
    price=cl[-1]; live=cands[-1].get("live",False)

    buy=[]; sell=[]; inds={}

    if rv<ros:
        buy.append("RSI Oversold"); inds["RSI"]={"signal":"BUY","detail":f"{rv} (<{int(ros)})"}
    elif rv>rob:
        sell.append("RSI Overbought"); inds["RSI"]={"signal":"SELL","detail":f"{rv} (>{int(rob)})"}
    else:
        inds["RSI"]={"signal":"NEUTRAL","detail":f"{rv} neutral"}

    if ml>slv and hist>0:
        buy.append("MACD Bullish"); inds["MACD"]={"signal":"BUY","detail":f"Hist +{round(hist,5)}"}
    elif ml<slv and hist<0:
        sell.append("MACD Bearish"); inds["MACD"]={"signal":"SELL","detail":f"Hist {round(hist,5)}"}
    else:
        inds["MACD"]={"signal":"NEUTRAL","detail":"No crossover"}

    if s20>s50:
        buy.append("SMA Golden Cross"); inds["SMA"]={"signal":"BUY","detail":f"20>{round(s50,4)}"}
    else:
        sell.append("SMA Death Cross"); inds["SMA"]={"signal":"SELL","detail":f"20<{round(s50,4)}"}

    if e9>e21:
        buy.append("EMA Cross Up"); inds["EMA"]={"signal":"BUY","detail":f"9>{round(e21,4)}"}
    else:
        sell.append("EMA Cross Down"); inds["EMA"]={"signal":"SELL","detail":f"9<{round(e21,4)}"}

    bp=(price-bbl)/(bbu-bbl)*100 if bbu!=bbl else 50
    if price<=bbl:
        buy.append("BB Lower Bounce"); inds["Bollinger"]={"signal":"BUY","detail":f"Lower {round(bbl,4)}"}
    elif price>=bbu:
        sell.append("BB Upper Reject"); inds["Bollinger"]={"signal":"SELL","detail":f"Upper {round(bbu,4)}"}
    else:
        inds["Bollinger"]={"signal":"NEUTRAL","detail":f"Pos {round(bp,1)}%"}

    if sk<20 and sd<20:
        buy.append("Stoch Oversold"); inds["Stochastic"]={"signal":"BUY","detail":f"K:{sk} D:{sd}"}
    elif sk>80 and sd>80:
        sell.append("Stoch Overbought"); inds["Stochastic"]={"signal":"SELL","detail":f"K:{sk} D:{sd}"}
    else:
        inds["Stochastic"]={"signal":"NEUTRAL","detail":f"K:{sk} D:{sd}"}

    srp=(price-sup)/(res-sup) if res!=sup else 0.5
    if srp<0.12:
        buy.append("Price at Support"); inds["S/R"]={"signal":"BUY","detail":f"S:{sup}"}
    elif srp>0.88:
        sell.append("Price at Resistance"); inds["S/R"]={"signal":"SELL","detail":f"R:{res}"}
    else:
        inds["S/R"]={"signal":"NEUTRAL","detail":f"S:{sup} R:{res}"}

    if pat_s=="BUY":
        buy.append(pat_n); inds["Pattern"]={"signal":"BUY","detail":pat_n}
    elif pat_s=="SELL":
        sell.append(pat_n); inds["Pattern"]={"signal":"SELL","detail":pat_n}
    else:
        inds["Pattern"]={"signal":"NEUTRAL","detail":pat_n}

    if ha and len(ha)>=2:
        hb=ha[-1]["close"]>ha[-1]["open"] and ha[-2]["close"]>ha[-2]["open"]
        hs=ha[-1]["close"]<ha[-1]["open"] and ha[-2]["close"]<ha[-2]["open"]
        if hb:
            buy.append("HA Bullish"); inds["Heiken Ashi"]={"signal":"BUY","detail":"2 green HA"}
        elif hs:
            sell.append("HA Bearish"); inds["Heiken Ashi"]={"signal":"SELL","detail":"2 red HA"}
        else:
            inds["Heiken Ashi"]={"signal":"NEUTRAL","detail":"Mixed HA"}
    else:
        inds["Heiken Ashi"]={"signal":"NEUTRAL","detail":"—"}

    if td=="UPTREND":
        buy.append("Uptrend"); inds["Trend"]={"signal":"BUY","detail":f"Up {ts}%"}
    elif td=="DOWNTREND":
        sell.append("Downtrend"); inds["Trend"]={"signal":"SELL","detail":f"Down {ts}%"}
    else:
        inds["Trend"]={"signal":"NEUTRAL","detail":"Sideways"}

    if mom>0.04:
        buy.append("Momentum Up"); inds["Momentum"]={"signal":"BUY","detail":f"ROC +{mom}%"}
    elif mom<-0.04:
        sell.append("Momentum Down"); inds["Momentum"]={"signal":"SELL","detail":f"ROC {mom}%"}
    else:
        inds["Momentum"]={"signal":"NEUTRAL","detail":f"ROC {mom}%"}

    if vc:
        (buy if len(buy)>len(sell) else sell).append("Volume Spike")
        inds["Volume"]={"signal":"ACTIVE","detail":"High volume confirms"}
    else:
        inds["Volume"]={"signal":"LOW","detail":"Low volume"}

    mc=int(cfg.get("min_conf",4)); bc=len(buy); sc=len(sell); tot=bc+sc or 1
    if bc>=mc and bc>sc:
        sig="BUY"; str_=round(bc/tot*100); conf=bc; clist=buy
    elif sc>=mc and sc>bc:
        sig="SELL"; str_=round(sc/tot*100); conf=sc; clist=sell
    else:
        sig="WAIT"; str_=0; conf=max(bc,sc); clist=[]

    rlo=int(cfg.get("risk_lo",60)); rme=int(cfg.get("risk_me",75))
    risk="LOW" if str_>=rme else "MEDIUM" if str_>=rlo else "HIGH"
    tfm={"1m":1,"5m":5,"15m":15,"30m":30}.get(tf,5)
    entry="Enter NOW — within 30 sec" if str_>=80 else "Enter at next candle close" if str_>=70 else "Wait — weak signal"
    expiry=tfm if str_>=80 else tfm*2

    return {"asset":asset,"signal":sig,"strength":str_,"timeframe":tf,"risk":risk,
            "confirmations":conf,"confirmations_list":clist,"indicators":inds,
            "price":price,"trend":td,"trend_strength":ts,"momentum":mom,
            "support":sup,"resistance":res,"entry_advice":entry,"expiry_minutes":expiry,
            "timestamp":datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "candles":cands[-40:],"data_source":"LIVE" if live else "SIM"}

@app.route("/")
def index(): return render_template("index.html")

@app.route("/api/signal")
def api_signal():
    asset=request.args.get("asset","EUR/USD"); tf=request.args.get("timeframe","5m")
    data=gen_signal(asset,tf,get_cfg())
    if data["signal"]!="WAIT":
        con=sqlite3.connect(DB); c=con.cursor()
        c.execute("""INSERT INTO signals(asset,signal,strength,timeframe,risk,confirmations,
                     price,indicators,conf_list,timestamp)VALUES(?,?,?,?,?,?,?,?,?,?)""",
                  (data["asset"],data["signal"],data["strength"],data["timeframe"],
                   data["risk"],data["confirmations"],data["price"],
                   json.dumps(data["indicators"]),json.dumps(data["confirmations_list"]),
                   data["timestamp"]))
        con.commit(); con.close()
    return jsonify(data)

@app.route("/api/all_signals")
def api_all():
    tf=request.args.get("timeframe","5m"); cfg=get_cfg()
    keys=["asset","signal","strength","risk","confirmations","price","trend","entry_advice","expiry_minutes","timestamp","data_source"]
    return jsonify([{k:gen_signal(a,tf,cfg)[k] for k in keys} for a in ALL_ASSETS])

@app.route("/api/history")
def api_hist():
    lim=request.args.get("limit",50)
    con=sqlite3.connect(DB); c=con.cursor()
    c.execute("SELECT id,asset,signal,strength,timeframe,risk,confirmations,price,timestamp,result FROM signals ORDER BY id DESC LIMIT ?",(lim,))
    rows=c.fetchall(); con.close()
    cols=["id","asset","signal","strength","timeframe","risk","confirmations","price","timestamp","result"]
    return jsonify([dict(zip(cols,r)) for r in rows])

@app.route("/api/stats")
def api_stats():
    con=sqlite3.connect(DB); c=con.cursor()
    def q(sql): c.execute(sql); return c.fetchone()[0]
    r={"total":q("SELECT COUNT(*) FROM signals"),"wins":q("SELECT COUNT(*) FROM signals WHERE result='WIN'"),
       "losses":q("SELECT COUNT(*) FROM signals WHERE result='LOSS'"),
       "buys":q("SELECT COUNT(*) FROM signals WHERE signal='BUY'"),
       "sells":q("SELECT COUNT(*) FROM signals WHERE signal='SELL'")};con.close()
    r["win_rate"]=round(r["wins"]/max(r["wins"]+r["losses"],1)*100,1)
    r["pending"]=r["total"]-r["wins"]-r["losses"]; return jsonify(r)

@app.route("/api/update_result",methods=["POST"])
def upd_result():
    d=request.get_json(); con=sqlite3.connect(DB); c=con.cursor()
    c.execute("UPDATE signals SET result=? WHERE id=?",(d["result"],d["id"])); con.commit(); con.close()
    return jsonify({"status":"ok"})

@app.route("/api/settings",methods=["GET","POST"])
def api_cfg():
    if request.method=="POST":
        d=request.get_json(); con=sqlite3.connect(DB); c=con.cursor()
        for k,v in d.items(): c.execute("UPDATE settings SET value=? WHERE key=?",(str(v),k))
        con.commit(); con.close(); return jsonify({"status":"saved"})
    return jsonify(get_cfg())

if __name__=="__main__":
    init_db(); app.run(debug=True,port=5000)
