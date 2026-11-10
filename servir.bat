@echo off
cd /d "%~dp0"
echo Busca tu IP con: ipconfig  (IPv4) y abre http://TU_IP:8080 en el otro dispositivo
python -m http.server 8080 --bind 0.0.0.0
