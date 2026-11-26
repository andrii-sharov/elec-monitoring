import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from text2path import text_path
from gen import BOLT, C
O='fonts/fontsource-onest-5.3.1/package/files/onest-'
def on(w): return [O+f'latin-{w}-normal.woff2', O+f'cyrillic-{w}-normal.woff2']
U='fonts/fontsource-unbounded-5.3.0/package/files/unbounded-'
UN=[U+'latin-600-normal.woff2', U+'cyrillic-600-normal.woff2']

def T(text, w, size, x, y, fill, anchor='start', cls=''):
    _,wd=text_path(text, on(w) if w!='U' else UN, size)
    if anchor=='middle': x-=wd/2
    elif anchor=='end': x-=wd
    d,_=text_path(text, on(w) if w!='U' else UN, size, x, y)
    c=f' class="{cls}"' if cls else ''
    return f'<path{c} fill="{fill}" d="{d}"/>'

def wrap(text, w, size, maxw):
    words=text.split(' '); lines=[]; cur=''
    for wd in words:
        t=(cur+' '+wd).strip()
        if text_path(t,on(w),size)[1] > maxw and cur: lines.append(cur); cur=wd
        else: cur=t
    lines.append(cur); return lines

# ---------- animated logo ----------
def logo_animated():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Electricity Monitor">
  <style>
    .trace{{stroke-dasharray:20 160;stroke-dashoffset:20;animation:trace 2.4s linear infinite}}
    .glow{{opacity:0;animation:glow 2.4s ease-out infinite}}
    .bolt{{transform-origin:33px 32px;animation:kick 2.4s ease-out infinite}}
    .ring{{transform-origin:51px 13px;animation:ring 2.4s ease-out infinite}}
    @keyframes trace{{0%{{stroke-dashoffset:20}}100%{{stroke-dashoffset:-120}}}}
    @keyframes glow{{0%,30%{{opacity:0}}42%{{opacity:.9}}70%,100%{{opacity:0}}}}
    @keyframes kick{{0%,32%{{transform:scale(1)}}40%{{transform:scale(1.07)}}55%,100%{{transform:scale(1)}}}}
    @keyframes ring{{0%{{transform:scale(1);opacity:.9}}60%,100%{{transform:scale(2.4);opacity:0}}}}
    @media (prefers-reduced-motion:reduce){{.trace,.glow,.bolt,.ring{{animation:none}}.trace,.ring,.glow{{opacity:0}}}}
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{C['bgA']}"/><stop offset="1" stop-color="{C['bgB']}"/></linearGradient>
    <mask id="gap" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><path d="{BOLT}" fill="#000" stroke="#000" stroke-width="6" stroke-linejoin="round"/></mask>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
    <clipPath id="tile"><rect width="64" height="64" rx="15"/></clipPath>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#bg)"/>
  <g clip-path="url(#tile)">
    <g mask="url(#gap)" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 34 H10 L14.5 27.5 L19 34 H30 M34 34 H58" stroke="{C['line']}" stroke-width="4"/>
      <path class="trace" pathLength="100" d="M6 34 H10 L14.5 27.5 L19 34 H58" stroke="#E6F1F5" stroke-width="4"/>
    </g>
    <path class="glow" d="{BOLT}" fill="{C['bolt']}" filter="url(#blur)"/>
    <path class="bolt" d="{BOLT}" fill="{C['bolt']}" stroke="{C['bolt']}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle class="ring" cx="51" cy="13" r="4.5" fill="none" stroke="{C['dot']}" stroke-width="1.5"/>
    <circle cx="51" cy="13" r="4.5" fill="{C['dot']}"/>
  </g>
</svg>
'''

# ---------- hero promo ----------
STR={
 'en':dict(dev='Your device', srv='Server', you='You', home='Home', now='now',
   off='Device stopped checking in', offb='Last signal: 18:42',
   on='Device is back online', onb='Offline for 2 h 15 min · suspected power outage',
   tg='Telegram', wh='Webhook · 200', notif='Notifications', label='Electricity Monitor: a device in your socket checks in with the server; when power goes out you get notified on Telegram or a webhook.'),
 'uk':dict(dev='Ваш пристрій', srv='Сервер', you='Ви', home='Дім', now='зараз',
   off="Пристрій перестав виходити на зв'язок", offb='Останній сигнал: 18:42',
   on='Пристрій знову в мережі', onb="Не було зв'язку 2 год 15 хв · імовірне відключення електрики",
   tg='Telegram', wh='Webhook · 200', notif='Сповіщення', label='Монітор електрики: пристрій у розетці виходить на зв’язок із сервером; коли зникає світло, ви отримуєте сповіщення в Telegram або вебхук.'),
 'ru':dict(dev='Ваше устройство', srv='Сервер', you='Вы', home='Дом', now='сейчас',
   off='Устройство перестало выходить на связь', offb='Последний сигнал: 18:42',
   on='Устройство снова в сети', onb='Не было связи 2 ч 15 мин · вероятное отключение электричества',
   tg='Telegram', wh='Webhook · 200', notif='Уведомления', label='Монитор электричества: устройство в розетке выходит на связь с сервером; когда пропадает свет, вы получаете уведомление в Telegram или вебхук.'),
}
def chip(x,y,txt,col):
    _,w=text_path(txt,on(500),9.5)
    return f'<rect x="{x}" y="{y}" width="{w+14:.1f}" height="16" rx="8" fill="{col}" fill-opacity=".16"/>'+T(txt,500,9.5,x+7,y+11.5,col)

def card(s, kind):
    # card in local coords, 196 wide
    col = '#FFA0AC' if kind=='off' else '#79DEB2'
    title = s['off'] if kind=='off' else s['on']; body = s['offb'] if kind=='off' else s['onb']
    tl=wrap(title,600,11.5,160); bl=wrap(body,400,10,166)
    h=34+len(tl)*14+len(bl)*13+24
    out=[f'<rect width="196" height="{h}" rx="14" fill="#203844" stroke="#405965"/>',
         f'<circle cx="16" cy="18" r="5" fill="{col}"/>', T(s['home'],600,12,28,22,'#E6F1F5'), T(s['now'],400,9.5,184,22,'#B2C8D1','end')]
    y=40
    for l in tl: out.append(T(l,600,11.5,12,y,'#E6F1F5')); y+=14
    y+=1
    for l in bl: out.append(T(l,400,10,12,y,'#B2C8D1')); y+=13
    out.append(chip(12,y-4,s['tg'],'#92CBE6'))
    if kind=='on':
        _,w=text_path(s['tg'],on(500),9.5); out.append(chip(12+w+20,y-4,s['wh'],'#79DEB2'))
    return '\n'.join(out), h

def hero(lang):
    s=STR[lang]
    c1,h1=card(s,'off'); c2,h2=card(s,'on')
    W,H=1000,560
    css=f'''
    *{{--T:12s}}
    .lit{{animation:lit 12s infinite}} .dark{{animation:dark 12s infinite}}
    @keyframes lit{{0%,37%{{opacity:1}}38%{{opacity:.2}}39%{{opacity:.9}}40%,66%{{opacity:0}}67%{{opacity:.6}}67.5%{{opacity:.1}}68%,100%{{opacity:1}}}}
    @keyframes dark{{0%,37%{{opacity:0}}40%,66%{{opacity:1}}68%,100%{{opacity:0}}}}
    .led{{animation:led 1.5s steps(1) infinite}}
    @keyframes led{{0%{{opacity:1}}20%,100%{{opacity:.25}}}}
    .pk{{animation:pk 1.5s cubic-bezier(.4,0,.6,1) infinite}}
    @keyframes pk{{0%{{transform:translateX(0);opacity:0}}8%{{opacity:1}}88%{{opacity:1}}100%{{transform:translateX(186px);opacity:0}}}}
    .beat{{transform-box:fill-box;transform-origin:center;animation:beat 1.5s ease-out infinite}}
    @keyframes beat{{0%,88%{{transform:scale(1)}}94%{{transform:scale(1.25)}}100%{{transform:scale(1)}}}}
    .s-on{{animation:son 12s infinite}} .s-wait{{animation:swait 12s infinite}} .s-off{{animation:soff 12s infinite}}
    @keyframes son{{0%,40%{{opacity:1}}41%,67%{{opacity:0}}69%,100%{{opacity:1}}}}
    @keyframes swait{{0%,40%{{opacity:0}}41%,49%{{opacity:1}}50%,100%{{opacity:0}}}}
    @keyframes soff{{0%,49%{{opacity:0}}50%,67%{{opacity:1}}69%,100%{{opacity:0}}}}
    .timer{{stroke-dasharray:100;stroke-dashoffset:100;animation:timer 12s linear infinite}}
    @keyframes timer{{0%,40%{{stroke-dashoffset:100;opacity:1}}49.5%{{stroke-dashoffset:0;opacity:1}}50.5%,100%{{stroke-dashoffset:0;opacity:0}}}}
    .ripple{{transform-box:fill-box;transform-origin:center;animation:ripple 12s ease-out infinite}}
    @keyframes ripple{{0%,49.5%{{transform:scale(1);opacity:0}}50%{{opacity:.9}}56%,100%{{transform:scale(3);opacity:0}}}}
    .ripple2{{transform-box:fill-box;transform-origin:center;animation:ripple2 12s ease-out infinite}}
    @keyframes ripple2{{0%,68.5%{{transform:scale(1);opacity:0}}69%{{opacity:.9}}75%,100%{{transform:scale(3);opacity:0}}}}
    .send1{{animation:send1 12s infinite}} .send2{{animation:send2 12s infinite}}
    @keyframes send1{{0%,50%{{transform:translateX(0);opacity:0}}50.5%{{opacity:1}}54%{{transform:translateX(176px);opacity:1}}54.5%,100%{{transform:translateX(176px);opacity:0}}}}
    @keyframes send2{{0%,69%{{transform:translateX(0);opacity:0}}69.5%{{opacity:1}}73%{{transform:translateX(176px);opacity:1}}73.5%,100%{{transform:translateX(176px);opacity:0}}}}
    .c1{{animation:c1 12s cubic-bezier(.2,.8,.2,1) infinite}} .c2{{animation:c2 12s cubic-bezier(.2,.8,.2,1) infinite}}
    @keyframes c1{{0%,54%{{transform:translateY(-14px);opacity:0}}57%{{transform:translateY(0);opacity:1}}73%{{transform:translateY(0)}}76%{{transform:translateY({h2+10}px)}}92%{{transform:translateY({h2+10}px);opacity:1}}97%,100%{{transform:translateY({h2+10}px);opacity:0}}}}
    @keyframes c2{{0%,73%{{transform:translateY(-14px);opacity:0}}76%{{transform:translateY(0);opacity:1}}92%{{opacity:1}}97%,100%{{opacity:0}}}}
    .phone-glow{{animation:pg 12s infinite}}
    @keyframes pg{{0%,54%{{opacity:0}}56%{{opacity:.7}}62%,73%{{opacity:0}}75%{{opacity:.7}}81%,100%{{opacity:0}}}}
    @media (prefers-reduced-motion:reduce){{
      .lit,.dark,.led,.pk,.beat,.s-on,.s-wait,.s-off,.timer,.ripple,.ripple2,.send1,.send2,.c1,.c2,.phone-glow{{animation:none}}
      .dark,.s-wait,.s-off,.timer,.ripple,.ripple2,.send1,.send2,.phone-glow{{opacity:0}} .pk{{opacity:0}}
      .c1{{transform:translateY({h2+10}px)}}
    }}'''
    house=f'''
  <g transform="translate(70 0)">
    <path d="M10 258 L100 182 L190 258" fill="none" stroke="#64808D" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="28" y="248" width="144" height="152" rx="6" fill="#192C36" stroke="#405965" stroke-width="2"/>
    <rect x="52" y="272" width="64" height="62" rx="5" fill="#0C161C"/>
    <g class="lit"><rect x="52" y="272" width="64" height="62" rx="5" fill="{C['bolt']}"/>
      <rect x="40" y="262" width="88" height="82" rx="12" fill="{C['bolt']}" opacity=".18" filter="url(#soft)"/></g>
    <path d="M84 272 V334 M52 303 H116" stroke="#192C36" stroke-width="4"/>
    <rect x="128" y="318" width="34" height="46" rx="8" fill="#DBE9EE"/>
    <circle cx="139" cy="333" r="3" fill="#738E9B"/><circle cx="151" cy="333" r="3" fill="#738E9B"/>
    <rect x="132" y="342" width="26" height="40" rx="4" fill="#166088" stroke="#0F4664" stroke-width="1.5"/>
    <rect x="137" y="350" width="16" height="12" rx="2" fill="#0F4664"/>
    <circle class="lit" cx="145" cy="372" r="3.2" fill="#79DEB2"/>
    <circle class="led lit" cx="145" cy="372" r="6" fill="#79DEB2" opacity=".35"/>
    <circle class="dark" cx="145" cy="372" r="3.2" fill="#405965"/>
  </g>'''
    srv=f'''
  <g transform="translate(450 0)">
    <rect x="0" y="236" width="100" height="134" rx="12" fill="#192C36" stroke="#405965" stroke-width="2"/>
    <g fill="#2A414D"><rect x="12" y="252" width="76" height="26" rx="5"/><rect x="12" y="290" width="76" height="26" rx="5"/><rect x="12" y="328" width="76" height="26" rx="5"/></g>
    <g fill="#92CBE6" opacity=".7"><circle cx="24" cy="265" r="3"/><circle cx="24" cy="303" r="3"/><circle cx="24" cy="341" r="3"/></g>
    <g stroke="#64808D" stroke-width="3" stroke-linecap="round"><path d="M40 265 H76 M40 303 H70 M40 341 H74"/></g>
    <g transform="translate(50 196)">
      <circle r="21" fill="none" stroke="#2A414D" stroke-width="3"/>
      <circle class="timer" r="21" fill="none" stroke="#F1C677" stroke-width="3" pathLength="100" transform="rotate(-90)" stroke-linecap="round"/>
      <circle class="ripple" r="12" fill="none" stroke="#FFA0AC" stroke-width="2"/>
      <circle class="ripple2" r="12" fill="none" stroke="#79DEB2" stroke-width="2"/>
      <g class="s-on"><circle class="beat" r="12" fill="#79DEB2"/></g>
      <circle class="s-wait" r="12" fill="#F1C677"/>
      <circle class="s-off" r="12" fill="#FFA0AC"/>
    </g>
  </g>'''
    wire=f'''
  <path d="M232 320 H446" stroke="#405965" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>
  <g class="lit"><circle class="pk" cx="252" cy="320" r="5" fill="#79DEB2"/></g>
  <path d="M554 300 H738" stroke="#405965" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>
  <circle class="send1" cx="560" cy="300" r="5" fill="#FFA0AC"/>
  <circle class="send2" cx="560" cy="300" r="5" fill="#79DEB2"/>'''
    phone=f'''
  <g transform="translate(742 96)">
    <rect class="phone-glow" x="-10" y="-10" width="240" height="388" rx="40" fill="#92CBE6" opacity="0" filter="url(#soft)"/>
    <rect width="220" height="368" rx="32" fill="#0C161C" stroke="#405965" stroke-width="2"/>
    <rect x="8" y="8" width="204" height="352" rx="25" fill="#192C36"/>
    <rect x="84" y="16" width="52" height="8" rx="4" fill="#0C161C"/>
    {T(s['notif'],600,11,22,50,'#B2C8D1')}
    <g transform="translate(12 64)">
      <g class="c1">{c1}</g>
      <g class="c2">{c2}</g>
    </g>
  </g>'''
    labels=''.join([T(s['dev'],500,13,170,452,'#B2C8D1','middle'),T(s['srv'],500,13,500,452,'#B2C8D1','middle'),T(s['you'],500,13,852,500,'#B2C8D1','middle')])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="{s['label']}">
  <style>{css}
  </style>
  <defs>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>
    <radialGradient id="hglow" cx="0.5" cy="0.45" r="0.65"><stop offset="0" stop-color="#1D78A8" stop-opacity=".35"/><stop offset="1" stop-color="#101D24" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#92CBE6" stroke-opacity=".06"/></pattern>
    <clipPath id="panel"><rect width="{W}" height="{H}" rx="28"/></clipPath>
  </defs>
  <g clip-path="url(#panel)">
    <rect width="{W}" height="{H}" fill="#101D24"/>
    <rect width="{W}" height="{H}" fill="url(#grid)"/>
    <rect width="{W}" height="{H}" fill="url(#hglow)"/>
    {wire}{house}{srv}{phone}
    {labels}
  </g>
</svg>
'''

os.makedirs('out', exist_ok=True)
open('out/logo-animated.svg','w').write(logo_animated())
for l in STR: open(f'out/hero-{l}.svg','w').write(hero(l))
print('ok')
