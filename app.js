import folium
from folium import MacroElement
from jinja2 import Template
from IPython.display import display

LAT = 46.5585
LON = -113.2240
MV = 2600
DA = 7200
WIND_SPEED = 12
WIND_DIR = 315

tiles = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
attr = "Tiles © Esri"
m = folium.Map(location=[LAT, LON], zoom_start=14, tiles=tiles, attr=attr)

class RangeCardUI(MacroElement):
    _template = Template("""
    {% macro script(this, kwargs) %}
    const map = {{this._parent.get_name()}};
    let shooterMarker, trps=[], activeTRP=null, activeLine=null, mpbrCircle=null;
    const da={{this.da}}, windSpeed={{this.ws}}, windDir={{this.wd}};
    let showWind = true;

    // ---------------- Gun profiles ----------------
    let gunProfiles = {};
    let activeGunProfile = null;
    gunProfiles[".308 175 SMK"] = {
        name: ".308 175 SMK",
        zeroRange: 100,
        sightHeight: 1.75,
        mv: 2600,
        bcType: "G7",
        bc: 0.243,
        twist: 11.25,
        bulletWeight: 175
    };
    activeGunProfile = gunProfiles[".308 175 SMK"];

    // ---------------- Utility ----------------
    function toRad(d){return d*Math.PI/180;}
    function toDeg(r){return r*180/Math.PI;}
    function cardinal(deg){ const dirs=["N","NE","E","SE","S","SW","W","NW"]; return dirs[Math.round(deg/45)%8]; }
    function distAz(a,b,c,d){
        const R=6371000;
        const φ1=toRad(a), φ2=toRad(c);
        const Δφ=toRad(c-a), Δλ=toRad(d-b);
        return [
            R*2*Math.asin(Math.sqrt(Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2)),
            (toDeg(Math.atan2(Math.sin(Δλ)*Math.cos(φ2),
                            Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ)))+360)%360
        ];
    }

    function elevHold(d){ const g=32.174; const ft=d*3.281; const adj=activeGunProfile.mv*(1+(da/5000)*0.01); return (0.5*g*(ft/adj)**2/ft)*1000; }
    function windRel(az){ return (windDir-az+540)%360-180; }
    function windHold(r){ return Math.abs(Math.sin(toRad(r))*windSpeed*0.1); }
    function windSide(r){ return r>=0?"RIGHT":"LEFT"; }
    function windClock(r){ let c=Math.round(Math.abs(r)/30); return c===0?12:c; }
    function calcMPBR(height){ const allow = height/2; const g=32.174; const adj = activeGunProfile.mv*(1+(da/5000)*0.01); let max=0;
        for(let d=50; d<=800; d+=5){ const drop=0.5*g*(d*3.281/adj)**2*12; if(drop<=allow) max=d; else break; } return max; }

    // ---------------- Panel UI ----------------
    const panel=L.control({position:"topright"});
    panel.onAdd=function(){
        const d=L.DomUtil.create("div");
        d.style.width="330px";
        d.style.background="rgba(15,15,15,0.88)";
        d.style.color="white";
        d.style.padding="12px";
        d.style.fontFamily="Arial";
        d.innerHTML=`
        <h3 style="margin:0 0 6px 0;">DIGITAL RANGE CARD</h3>

        <b>GUN PROFILE</b><br>
        <select id="gunSelect" style="width:150px;"></select>
        <button id="newGun">+</button>
        <button id="editGun">✎</button><hr>

        <b>ENGAGEMENT</b><br>
        TRP: <select id="trpSelect" style="width:150px;"></select><br>
        <div id="eng">Click map to add TRP</div><hr>

        <b>WIND</b><br>
        <label><input type="checkbox" id="windToggle" checked> Show Wind Arrows</label><br>
        ${windSpeed} MPH FROM ${cardinal(windDir)} (${windDir}°)<hr>

        <b>MAX PBR</b><br>
        Target Height (in)<br>
        <input id="h" type="number" value="10" style="width:60px;">
        <button id="set">SET</button>
        <div id="mpbr">—</div>`;
        L.DomEvent.disableClickPropagation(d);
        return d;
    };
    panel.addTo(map);

    const gunSelect=document.getElementById("gunSelect");
    const windToggle=document.getElementById("windToggle");

    function refreshGuns(){
        gunSelect.innerHTML="";
        for(let k in gunProfiles){
            const o=document.createElement("option");
            o.value=k; o.text=k; gunSelect.appendChild(o);
        }
        gunSelect.value=activeGunProfile.name;
    }
    refreshGuns();

    gunSelect.onchange=function(){
        activeGunProfile=gunProfiles[this.value];
        recalcAll();
        updateMPBR();  // automatically update MaxPBR when switching gun profiles
    };

    document.getElementById("newGun").onclick=function(){
        const name=prompt("Profile Name"); if(!name) return;
        gunProfiles[name]={
            name,
            zeroRange:+prompt("Zero Range (yd)"),
            sightHeight:+prompt("Sight Height (in)"),
            mv:+prompt("MV (fps)"),
            bcType:prompt("BC Type (G1/G7)"),
            bc:+prompt("BC"),
            twist:+prompt("Twist Rate"),
            bulletWeight:+prompt("Bullet Weight (gr)")
        };
        activeGunProfile=gunProfiles[name];
        refreshGuns();
        recalcAll();
        updateMPBR(); // update automatically after creating new gun profile
    };

    document.getElementById("editGun").onclick=function(){
        const g=activeGunProfile; if(!g) return;
        const zeroRange=parseFloat(prompt("Zero Range (yd)",g.zeroRange));
        const sightHeight=parseFloat(prompt("Sight Height (in)",g.sightHeight));
        const mv=parseFloat(prompt("MV (fps)",g.mv));
        const bcType=prompt("BC Type (G1/G7)",g.bcType);
        const bc=parseFloat(prompt("BC",g.bc));
        const twist=parseFloat(prompt("Twist Rate (in)",g.twist));
        const bulletWeight=parseFloat(prompt("Bullet Weight (gr)",g.bulletWeight));
        Object.assign(g,{zeroRange,sightHeight,mv,bcType,bc,twist,bulletWeight});
        recalcAll();
        updateMPBR(); // update automatically after editing
    };

    windToggle.onchange=function(){ showWind=this.checked; updateAllWindArrows(); };

    shooterMarker=L.marker([{{this.lat}},{{this.lon}}],{draggable:true,icon:L.icon({iconUrl:"https://maps.google.com/mapfiles/ms/icons/blue-dot.png",iconSize:[32,32],iconAnchor:[16,16]})}).addTo(map);

    function recalcTRP(t){
        const s=shooterMarker.getLatLng(), p=t.marker.getLatLng();
        const [d,az]=distAz(s.lat,s.lng,p.lat,p.lng);
        const rel=windRel(az);
        Object.assign(t,{
            d,az,
            elev:elevHold(d),
            wind:windHold(rel),
            side:windSide(rel),
            clock:windClock(rel)
        });
        updateWindArrow(t, az);
    }

    function drawLine(t){
        if(activeLine) map.removeLayer(activeLine);
        activeLine=L.polyline([shooterMarker.getLatLng(),t.marker.getLatLng()],{color:"#00ff00",weight:2}).addTo(map);
    }

    function updatePanel(t){
        document.getElementById("eng").innerHTML=
        `<b>${t.name}</b><br>
        RANGE: ${t.d.toFixed(0)} m<br>
        AZ: ${t.az.toFixed(0)}°<br>
        ELEV: ${t.elev.toFixed(2)} mil<br>
        WIND: ${t.clock} O'CLOCK<br>
        HOLD: ${t.wind.toFixed(2)} mil ${t.side}`;
        document.getElementById("trpSelect").value=t.name;
    }

    // ---------------- MAX PBR ----------------
    function updateMPBR(){
        const h=+document.getElementById("h").value;
        const g=32.174;
        const adj=activeGunProfile.mv*(1+(da/5000)*0.01);
        let d=0;
        for(let r=50;r<=800;r+=5){ if(0.5*g*(r*3.281/adj)**2*12<=h/2) d=r; }
        const hold=elevHold(d);
        if(mpbrCircle) mpbrCircle.setLatLng(shooterMarker.getLatLng()).setRadius(d);
        else mpbrCircle=L.circle(shooterMarker.getLatLng(),{radius:d,color:"#FFD166",weight:2,fill:false}).addTo(map);
        document.getElementById("mpbr").innerHTML=`MAX: ${d} m<br>HOLD: ${hold.toFixed(2)} mil`;
    }

    document.getElementById("set").onclick=updateMPBR;

    function recalcAll(){
        trps.forEach(t=>{ recalcTRP(t); if(t===activeTRP){ drawLine(t); updatePanel(t); } });
        if(mpbrCircle) updateMPBR(); // <-- recalc and move MaxPBR when shooter moves
    }

    // ---------------- Wind Arrow ----------------
    function updateWindArrow(t, azimuth){
        if(t.windArrow) map.removeLayer(t.windArrow);
        if(!showWind) return;
        const latlng = t.marker.getLatLng();
        const offsetLat = latlng.lat + 0.00025;
        const offsetLng = latlng.lng + 0.00025;
        const relativeAngle = windDir - azimuth + 90;
        const arrowDiv = L.divIcon({
            className: 'wind-arrow',
            html: `<div style="transform: rotate(${relativeAngle}deg); font-size:36px; color:#FF0000; font-weight:bold;">&#8593;</div>`,
            iconSize:[36,36],
            iconAnchor:[18,18]
        });
        t.windArrow = L.marker([offsetLat, offsetLng], {icon: arrowDiv, interactive:false}).addTo(map);
    }

    function updateAllWindArrows(){ trps.forEach(t=>updateWindArrow(t, t.az)); }

    shooterMarker.on("drag", recalcAll);

    const trpSelect=document.getElementById("trpSelect");
    trpSelect.onchange=function(){
        const t=trps.find(x=>x.name===this.value);
        if(t){ activeTRP=t; drawLine(t); updatePanel(t); }
    };

    map.on("click", e=>{
        const name=prompt("TRP Name"); if(!name) return;
        const m=L.marker(e.latlng,{draggable:true,icon:L.icon({iconUrl:"https://maps.google.com/mapfiles/ms/icons/red-dot.png",iconSize:[32,32],iconAnchor:[16,16]})}).addTo(map);
        const t={name,marker:m}; trps.push(t); recalcTRP(t);

        const o=document.createElement("option"); o.value=name; o.text=name; trpSelect.appendChild(o);

        m.on("click",()=>{activeTRP=t;drawLine(t);updatePanel(t);});
        m.on("drag",()=>{recalcTRP(t);if(t===activeTRP){drawLine(t);updatePanel(t);}});
        activeTRP=t; drawLine(t); updatePanel(t);
    });
    {% endmacro %}
    """)

    def __init__(self):
        super().__init__()
        self.lat=LAT
        self.lon=LON
        self.da=DA
        self.ws=WIND_SPEED
        self.wd=WIND_DIR

m.add_child(RangeCardUI())
display(m)
