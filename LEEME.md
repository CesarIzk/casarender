# Casa con luces

1. Exporta desde Blender a `casa.glb` (glTF Binary, **Punctual Lights** activado; Meshopt opcional, Draco no soportado) y ponlo en esta carpeta.
2. Nombra las luces `foco_<grupo>_<numero>`, por ejemplo `foco_techo_01`, `foco_puerta_03`.
3. Sin `casa.glb` se muestra una casa de ejemplo; también puedes arrastrar un .glb a la página.

## Red local
- Windows: doble clic a `servir.bat`. Mac/Linux: `./servir.sh`. (Requiere Python.)
- En el celular/tablet (misma Wi‑Fi): `http://IP-DE-TU-PC:8080`
- Si no conecta, permite Python en el firewall.

## Netlify
- Entra a https://app.netlify.com/drop y arrastra **esta carpeta completa** (con casa.glb dentro).
- Todo es estático; no necesita build ni cuenta de pago.
