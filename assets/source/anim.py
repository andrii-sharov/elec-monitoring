import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from text2path import text_path
from brand import WAVE, C
O='fonts/fontsource-inter-5.3.0/package/files/inter-'
def on(w): return [O+f'latin-{w}-normal.woff2', O+f'cyrillic-{w}-normal.woff2']
U='fonts/fontsource-jetbrains-mono-5.3.0/package/files/jetbrains-mono-'
UN=[U+'latin-700-normal.woff2', U+'cyrillic-700-normal.woff2']

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
    .trace{{stroke-dasharray:14 200;stroke-dashoffset:14;animation:trace 2.4s linear infinite}}
    .ring{{transform-origin:52px 22px;animation:ring 2.4s ease-out infinite}}
    .dot{{transform-origin:52px 22px;animation:kick 2.4s ease-out infinite}}
    @keyframes trace{{0%{{stroke-dashoffset:14}}70%,100%{{stroke-dashoffset:-100}}}}
    @keyframes kick{{0%,62%{{transform:scale(1)}}70%{{transform:scale(1.3)}}85%,100%{{transform:scale(1)}}}}
    @keyframes ring{{0%,65%{{transform:scale(1);opacity:0}}70%{{opacity:.9}}100%{{transform:scale(2.6);opacity:0}}}}
    @media (prefers-reduced-motion:reduce){{.trace,.ring,.dot{{animation:none}}.trace,.ring{{opacity:0}}}}
  </style>
  <rect width="64" height="64" rx="14" fill="{C['tile']}"/>
  <rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="{C['edge']}" stroke-width="2"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="{WAVE}" stroke="{C['signal']}" stroke-width="4.5"/>
    <path class="trace" pathLength="100" d="{WAVE}" stroke="#F4FFD6" stroke-width="4.5"/>
  </g>
  <circle class="ring" cx="52" cy="22" r="4.5" fill="none" stroke="{C['cyan']}" stroke-width="1.5"/>
  <circle class="dot" cx="52" cy="22" r="4.5" fill="{C['cyan']}"/>
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
    col = '#FF7A7A' if kind=='off' else '#C8F560'
    title = s['off'] if kind=='off' else s['on']; body = s['offb'] if kind=='off' else s['onb']
    tl=wrap(title,600,11.5,160); bl=wrap(body,400,10,166)
    h=34+len(tl)*14+len(bl)*13+24
    out=[f'<rect width="196" height="{h}" rx="14" fill="#1D2833" stroke="#2A3742"/>',
         f'<circle cx="16" cy="18" r="5" fill="{col}"/>', T(s['home'],600,12,28,22,'#E8F0F4'), T(s['now'],400,9.5,184,22,'#93A4B0','end')]
    y=40
    for l in tl: out.append(T(l,600,11.5,12,y,'#E8F0F4')); y+=14
    y+=1
    for l in bl: out.append(T(l,400,10,12,y,'#93A4B0')); y+=13
    out.append(chip(12,y-4,s['tg'],'#5CE1E6'))
    if kind=='on':
        _,w=text_path(s['tg'],on(500),9.5); out.append(chip(12+w+20,y-4,s['wh'],'#C8F560'))
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
    <path d="M10 258 L100 182 L190 258" fill="none" stroke="#5A6B78" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="28" y="248" width="144" height="152" rx="6" fill="#151E27" stroke="#2A3742" stroke-width="2"/>
    <rect x="52" y="272" width="64" height="62" rx="5" fill="#070A0E"/>
    <g class="lit"><rect x="52" y="272" width="64" height="62" rx="5" fill="{C['lamp']}"/>
      <rect x="40" y="262" width="88" height="82" rx="12" fill="{C['lamp']}" opacity=".18" filter="url(#soft)"/></g>
    <path d="M84 272 V334 M52 303 H116" stroke="#151E27" stroke-width="4"/>
    <rect x="128" y="318" width="34" height="46" rx="8" fill="#C9D3DA"/>
    <circle cx="139" cy="333" r="3" fill="#5A6B78"/><circle cx="151" cy="333" r="3" fill="#5A6B78"/>
    <rect x="132" y="342" width="26" height="40" rx="4" fill="#2A3742" stroke="#151E27" stroke-width="1.5"/>
    <rect x="137" y="350" width="16" height="12" rx="2" fill="#151E27"/>
    <circle class="lit" cx="145" cy="372" r="3.2" fill="#C8F560"/>
    <circle class="led lit" cx="145" cy="372" r="6" fill="#C8F560" opacity=".35"/>
    <circle class="dark" cx="145" cy="372" r="3.2" fill="#2A3742"/>
  </g>'''
    srv=f'''
  <g transform="translate(450 0)">
    <rect x="0" y="236" width="100" height="134" rx="12" fill="#151E27" stroke="#2A3742" stroke-width="2"/>
    <g fill="#222E39"><rect x="12" y="252" width="76" height="26" rx="5"/><rect x="12" y="290" width="76" height="26" rx="5"/><rect x="12" y="328" width="76" height="26" rx="5"/></g>
    <g fill="#5CE1E6" opacity=".7"><circle cx="24" cy="265" r="3"/><circle cx="24" cy="303" r="3"/><circle cx="24" cy="341" r="3"/></g>
    <g stroke="#5A6B78" stroke-width="3" stroke-linecap="round"><path d="M40 265 H76 M40 303 H70 M40 341 H74"/></g>
    <g transform="translate(50 196)">
      <circle r="21" fill="none" stroke="#222E39" stroke-width="3"/>
      <circle class="timer" r="21" fill="none" stroke="#FFC857" stroke-width="3" pathLength="100" transform="rotate(-90)" stroke-linecap="round"/>
      <circle class="ripple" r="12" fill="none" stroke="#FF7A7A" stroke-width="2"/>
      <circle class="ripple2" r="12" fill="none" stroke="#C8F560" stroke-width="2"/>
      <g class="s-on"><circle class="beat" r="12" fill="#C8F560"/></g>
      <circle class="s-wait" r="12" fill="#FFC857"/>
      <circle class="s-off" r="12" fill="#FF7A7A"/>
    </g>
  </g>'''
    wire=f'''
  <path d="M232 320 H446" stroke="#2A3742" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>
  <g class="lit"><circle class="pk" cx="252" cy="320" r="5" fill="#C8F560"/></g>
  <path d="M554 300 H738" stroke="#2A3742" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>
  <circle class="send1" cx="560" cy="300" r="5" fill="#FF7A7A"/>
  <circle class="send2" cx="560" cy="300" r="5" fill="#C8F560"/>'''
    phone=f'''
  <g transform="translate(742 96)">
    <rect class="phone-glow" x="-10" y="-10" width="240" height="388" rx="40" fill="#5CE1E6" opacity="0" filter="url(#soft)"/>
    <rect width="220" height="368" rx="32" fill="#070A0E" stroke="#2A3742" stroke-width="2"/>
    <rect x="8" y="8" width="204" height="352" rx="25" fill="#151E27"/>
    <rect x="84" y="16" width="52" height="8" rx="4" fill="#070A0E"/>
    {T(s['notif'],600,11,22,50,'#93A4B0')}
    <g transform="translate(12 64)">
      <g class="c1">{c1}</g>
      <g class="c2">{c2}</g>
    </g>
  </g>'''
    labels=''.join([T(s['dev'],500,13,170,452,'#93A4B0','middle'),T(s['srv'],500,13,500,452,'#93A4B0','middle'),T(s['you'],500,13,852,500,'#93A4B0','middle')])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="{s['label']}">
  <style>{css}
  </style>
  <defs>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>
    <radialGradient id="hglow" cx="0.5" cy="0.45" r="0.65"><stop offset="0" stop-color="#5CE1E6" stop-opacity=".12"/><stop offset="1" stop-color="#0B1015" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#C8F560" stroke-opacity=".06"/></pattern>
    <clipPath id="panel"><rect width="{W}" height="{H}" rx="28"/></clipPath>
  </defs>
  <g clip-path="url(#panel)">
    <rect width="{W}" height="{H}" fill="#0B1015"/>
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
