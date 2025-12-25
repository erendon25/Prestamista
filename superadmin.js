const auth = window.auth;
const db = window.db;

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  try {
    const userDoc = await db.collection('users').doc(user.uid).get();

    if (!userDoc.exists) {
      alert('Acceso denegado: Usuario no configurado como superadmin.');
      window.location.href = 'login.html';
      return;
    }

    const data = userDoc.data();
    if (data.tenantCode !== 'SUPERADMIN' && data.role !== 'superadmin') {
      alert('Acceso denegado: Solo el superadmin puede acceder a esta página.');
      window.location.href = 'login.html';
      return;
    }

    loadCodes();

  } catch (error) {
    console.error('Error verificando acceso superadmin:', error);
    alert('Error de conexión. Intenta nuevamente.');
    window.location.href = 'login.html';
  }
});

document.getElementById('generate-code').addEventListener('click', async () => {
  try {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    await db.collection('tenants').doc(code).set({
      assigned: false,
      blocked: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    loadCodes();
  } catch (error) {
    console.error('Error generando código:', error);
    alert('Error al generar el código.');
  }
});

async function loadCodes() {
  const list = document.getElementById('codes-list');
  list.innerHTML = '<li>Cargando códigos...</li>';

  try {
    const snapshot = await db.collection('tenants')
      .orderBy('createdAt', 'desc')
      .get();

    list.innerHTML = '';

    if (snapshot.empty) {
      list.innerHTML = '<li>No hay códigos generados aún.</li>';
      return;
    }

    snapshot.forEach(doc => {
      const data = doc.data();
      const li = document.createElement('li');
      li.style.cssText = 'background: #f8f9fa; margin: 10px 0; padding: 15px; border-radius: 8px; font-size: 1.2em; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;';

      li.innerHTML = `
        <span>Código: <strong>${doc.id}</strong> → ${data.assigned ? 'Asignado' : 'Disponible'} ${data.blocked ? '(Bloqueado)' : ''}</span>
        <div>
          <button onclick="toggleBlock('${doc.id}', ${data.blocked})" style="margin-left: 5px; padding: 5px 10px; background: ${data.blocked ? '#28a745' : '#dc3545'}; color: white;">${data.blocked ? 'Desbloquear' : 'Bloquear'}</button>
          <button onclick="deleteCode('${doc.id}')" style="margin-left: 5px; padding: 5px 10px; background: #ffc107; color: black;">Eliminar Cuenta</button>
        </div>
      `;

      list.appendChild(li);
    });
  } catch (error) {
    console.error('Error cargando códigos:', error);
    list.innerHTML = '<li>Error al cargar los códigos.</li>';
  }
}

async function toggleBlock(code, currentBlocked) {
  if (confirm(`¿${currentBlocked ? 'Desbloquear' : 'Bloquear'} el código ${code}?`)) {
    await db.collection('tenants').doc(code).update({ blocked: !currentBlocked });
    loadCodes();
  }
}

async function deleteCode(code) {
  if (confirm(`¿Eliminar permanentemente el código ${code} y todos sus préstamos/movimientos? Esta acción es irreversible.`)) {
    try {
      // Eliminar subcolecciones
      const loansSnap = await db.collection('tenants').doc(code).collection('loans').get();
      const batch = db.batch();
      loansSnap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      const movSnap = await db.collection('tenants').doc(code).collection('movimientos').get();
      const batch2 = db.batch();
      movSnap.forEach(doc => batch2.delete(doc.ref));
      await batch2.commit();

      // Eliminar documento tenant
      await db.collection('tenants').doc(code).delete();

      loadCodes();
      alert('Código y datos eliminados correctamente.');
    } catch (error) {
      console.error('Error eliminando código:', error);
      alert('Error al eliminar.');
    }
  }
}

document.getElementById('logout-btn').addEventListener('click', () => {
  auth.signOut().then(() => {
    window.location.href = 'login.html';
  });
});