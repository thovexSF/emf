# Guía de Desarrollo - EMF AYR

## 🚨 IMPORTANTE: No afectar producción

Esta guía establece el proceso de desarrollo para evitar afectar el entorno de producción.

## 📋 Flujo de Trabajo Recomendado

### 1. Crear una rama de desarrollo

**NUNCA trabajar directamente en `main`** cuando hay cambios que puedan afectar producción.

```bash
# Crear y cambiar a una nueva rama
git checkout -b feature/nombre-de-la-funcionalidad

# O para correcciones
git checkout -b fix/descripcion-del-bug
```

### 2. Desarrollo local

```bash
# Instalar dependencias si es necesario
cd client && npm install
cd ../server && npm install

# Ejecutar en modo desarrollo
# Terminal 1 - Servidor
cd server
npm run dev  # o el comando que uses para desarrollo

# Terminal 2 - Cliente
cd client
npm start
```

### 3. Testing antes de commit

**Siempre probar localmente antes de hacer commit:**

- ✅ Probar todas las funcionalidades afectadas
- ✅ Verificar que no hay errores en consola
- ✅ Probar en modo claro y oscuro (si aplica)
- ✅ Verificar que los datos se guardan correctamente
- ✅ Probar casos edge (valores vacíos, negativos, etc.)

### 4. Commit y Push

```bash
# Agregar cambios
git add .

# Commit descriptivo
git commit -m "Descripción clara de los cambios realizados"

# Push a la rama (NO a main directamente)
git push origin feature/nombre-de-la-funcionalidad
```

### 5. Merge a producción

**Proceso recomendado:**

1. **Crear Pull Request** en GitHub para revisar cambios
2. **Revisar el diff** completo antes de mergear
3. **Mergear a main** solo cuando estés seguro
4. **Desplegar a producción** después del merge

### 6. Despliegue a producción

Si usas Railway, Vercel, o similar:

```bash
# Asegúrate de estar en main y actualizado
git checkout main
git pull origin main

# El despliegue automático debería activarse
# O ejecutar el comando de despliegue manual si es necesario
```

## ⚠️ Reglas de Oro

### ✅ HACER:

1. **Siempre crear una rama** para cambios significativos
2. **Probar localmente** antes de hacer push
3. **Commits descriptivos** que expliquen qué y por qué
4. **Revisar cambios** antes de mergear a main
5. **Backup de datos** antes de cambios en esquema de BD
6. **Documentar cambios** importantes en código o README

### ❌ NO HACER:

1. **NO hacer push directo a main** sin revisar
2. **NO hacer cambios en producción** sin probar localmente
3. **NO hacer commits grandes** sin dividir en commits lógicos
4. **NO ignorar errores** de linter o tests
5. **NO hacer cambios** que rompan funcionalidades existentes sin avisar

## 🔧 Configuración de Entornos

### Variables de Entorno

**Desarrollo local:**
- `.env` en `server/` y `client/`
- No commitear archivos `.env` con datos sensibles

**Producción:**
- Configurar variables en la plataforma de hosting
- Nunca hardcodear credenciales en código

## 📝 Checklist antes de mergear a main

- [ ] Código probado localmente
- [ ] Sin errores de linter
- [ ] Sin console.logs innecesarios
- [ ] Variables de entorno configuradas
- [ ] Documentación actualizada (si aplica)
- [ ] Cambios compatibles con producción
- [ ] Backup realizado (si hay cambios en BD)

## 🐛 Debugging en Producción

Si necesitas debuggear producción:

1. **Revisar logs** en la plataforma de hosting
2. **No hacer cambios directos** en producción
3. **Reproducir el problema** localmente
4. **Crear fix en rama** separada
5. **Probar el fix** antes de desplegar

## 📚 Recursos

- **Git Flow**: Considerar usar Git Flow para proyectos grandes
- **Feature Flags**: Para features que se activan/desactivan
- **Staging Environment**: Ideal tener un entorno de staging antes de producción

## 🔄 Proceso de Rollback

Si algo sale mal en producción:

```bash
# Revertir el último commit
git revert HEAD
git push origin main

# O volver a un commit anterior específico
git revert <commit-hash>
git push origin main
```

## 📞 Contacto

Si tienes dudas sobre el proceso de desarrollo, consulta antes de hacer cambios que puedan afectar producción.

---

## 🔥 Solución al Crash de Railway (Noviembre 2025)

### Problema Identificado

El servidor crasheaba en Railway con error `SIGTERM` debido a:

1. **Script de inicio incorrecto**: `package.json` tenía `"start": "npm run dev"` que ejecutaba `concurrently` con cliente y servidor, cuando en producción solo debe ejecutarse el servidor.

2. **Healthcheck agresivo**: Railway estaba verificando `/api/fetch-data` (query completa a DB) con timeout de solo 100ms, causando reinicios constantes.

3. **Proceso de build**: El cliente React no estaba siendo servido correctamente como archivos estáticos.

### Cambios Aplicados

#### 1. package.json (raíz)
```json
// ANTES
"start": "npm run dev"

// DESPUÉS
"start": "cd server && npm start"
```

#### 2. railway.toml
```toml
# ANTES
healthcheckPath = "/api/fetch-data"
healthcheckTimeout = 100

# DESPUÉS
healthcheckPath = "/api/health"
healthcheckTimeout = 30
```

### Cómo Funciona Ahora

**Desarrollo local:**
```bash
npm run dev  # Ejecuta cliente (puerto 3001) y servidor (puerto 3000) con concurrently
```

**Producción (Railway):**
```bash
npm start  # Solo ejecuta el servidor que sirve los archivos estáticos del cliente construido
```

### Build Process en Railway

1. `npm run build` → Construye el cliente React en `client/build/`
2. `npm start` → Ejecuta solo el servidor (`cd server && npm start`)
3. El servidor Express sirve los archivos estáticos desde `client/build/` cuando `NODE_ENV=production`

### Verificación Post-Deploy

Después de desplegar, verifica:

- ✅ `/api/health` responde correctamente
- ✅ La aplicación React carga sin errores
- ✅ Los logs no muestran errores de healthcheck
- ✅ El cron job se ejecuta sin crashear el servidor

---

**Última actualización**: Noviembre 2025


