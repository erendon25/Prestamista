const auth = window.auth;
const db = window.db;

document.addEventListener('DOMContentLoaded', () => {
  auth.onAuthStateChanged(user => {
    if (!user) {
      window.location.replace('login.html');
      return;
    }

    db.collection('users').doc(user.uid).get().then(doc => {
      if (!doc.exists || doc.data().tenantCode !== 'SUPERADMIN') {
        window.location.replace('login.html');
      } else {
        loadCodes();
        loadGlobalUsage();
      }
    }).catch(err => {
      console.error(err);
      window.location.replace('login.html');
    });
  });

  document.getElementById('generate-code').onclick = async () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
      await db.collection('tenants').doc(code).set({
        assigned: false,
        blocked: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      alert(`Código generado: ${code}`);
      loadCodes();
    } catch (error) {
      alert('Error al generar código');
      console.error(error);
    }
  };

  document.getElementById('logout-btn').onclick = () => {
    auth.signOut().then(() => window.location.replace('login.html'));
  };
});

async function loadCodes() {
  const list = document.getElementById('codes-list');
  list.innerHTML = '<li style="padding:10px;color:#666;">Cargando códigos...</li>';

  const snapshot = await db.collection('tenants').orderBy('createdAt', 'desc').get();
  list.innerHTML = '';

  // Agregar encabezado con total
  const header = document.createElement('li');
  header.style.cssText = 'background:#e9ecef;padding:15px;margin:8px 0;border-radius:8px;font-weight:bold;text-align:center;';
  header.textContent = `Total de códigos generados: ${snapshot.size}`;
  list.appendChild(header);

  if (snapshot.empty) {
    list.innerHTML += '<li style="padding:10px;color:#999;text-align:center;">No hay códigos generados aún.</li>';
    return;
  }

  snapshot.forEach(doc => {
    const data = doc.data();
    const li = document.createElement('li');
    li.style.cssText = 'background:#f8f9fa;padding:15px;margin:8px 0;border-radius:8px;display:flex;justify-content:space-between;align-items:center;transition:background 0.3s;';
    li.style.cursor = data.assigned ? 'pointer' : 'default';

    li.innerHTML = `
      <strong>${doc.id}</strong>
      <span style="color:${data.assigned ? '#28a745' : '#ffc107'};font-weight:bold;">
        ${data.assigned ? 'Asignado' : 'Disponible'}
        ${data.blocked ? ' | Bloqueado' : ''}
      </span>
    `;

    if (data.assigned) {
      li.onclick = () => toggleTenantDetails(doc.id, li);
    }

    list.appendChild(li);
  });
}

async function toggleTenantDetails(tenantCode, clickedLi) {
  let detailsDiv = clickedLi.nextElementSibling;
  if (detailsDiv && detailsDiv.classList.contains('tenant-details')) {
    detailsDiv.style.height = '0';
    setTimeout(() => detailsDiv.remove(), 400);
    return;
  }

  document.querySelectorAll('.tenant-details').forEach(el => {
    el.style.height = '0';
    setTimeout(() => el.remove(), 400);
  });

  // Obtener datos del tenant y del usuario
  const tenantSnap = await db.collection('tenants').doc(tenantCode).get();
  if (!tenantSnap.exists) return;
  const tenantData = tenantSnap.data();

  const usersSnapshot = await db.collection('users').where('tenantCode', '==', tenantCode).get();
  if (usersSnapshot.empty) return;

  const userDoc = usersSnapshot.docs[0];
  const userData = userDoc.data();
  const email = userData.email || 'No disponible';

  detailsDiv = document.createElement('div');
  detailsDiv.className = 'tenant-details';
  detailsDiv.style.cssText = 'overflow:hidden;transition:height 0.4s ease;background:white;border-radius:8px;margin:8px 0;padding:0 15px;box-shadow:0 4px 10px rgba(0,0,0,0.1);height:0;';

  detailsDiv.innerHTML = `
    <div style="padding:15px 0;">
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Tenant:</strong> ${tenantCode}</p>
      <p><strong>UID:</strong> <small>${userDoc.id}</small></p>
      <div style="margin-top:15px;display:flex;gap:10px;justify-content:flex-end;">
        <button class="block-btn" data-tenant="${tenantCode}" style="padding:8px 16px;background:#ffc107;color:black;border:none;border-radius:6px;cursor:pointer;">
          ${tenantData.blocked ? 'Desbloquear' : 'Bloquear'}
        </button>
        <button class="delete-btn" data-tenant="${tenantCode}" data-uid="${userDoc.id}" style="padding:8px 16px;background:#dc3545;color:white;border:none;border-radius:6px;cursor:pointer;">
          Eliminar Cuenta
        </button>
      </div>
    </div>
  `;

  clickedLi.parentNode.insertBefore(detailsDiv, clickedLi.nextSibling);

  requestAnimationFrame(() => {
    detailsDiv.style.height = detailsDiv.scrollHeight + 'px';
  });

  detailsDiv.querySelector('.block-btn').onclick = async (e) => {
    e.stopPropagation();
    const tenant = e.target.dataset.tenant;
    const currentBlocked = e.target.textContent.includes('Desbloquear');
    try {
      await db.collection('tenants').doc(tenant).update({ blocked: !currentBlocked });
      alert(currentBlocked ? 'Tenant desbloqueado' : 'Tenant bloqueado');
      loadCodes();
    } catch (err) {
      alert('Error al cambiar estado');
      console.error(err);
    }
  };

  detailsDiv.querySelector('.delete-btn').onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar permanentemente esta cuenta y todos sus datos? Esta acción es irreversible.')) return;
    const tenant = e.target.dataset.tenant;
    const uid = e.target.dataset.uid;
    try {
      await db.collection('users').doc(uid).delete();
      await db.collection('tenants').doc(tenant).delete();
      const collections = ['loans', 'movimientos'];
      for (const col of collections) {
        const snap = await db.collection('tenants').doc(tenant).collection(col).get();
        const batch = db.batch();
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      alert('Cuenta eliminada completamente');
      loadCodes();
    } catch (err) {
      alert('Error al eliminar cuenta');
      console.error(err);
    }
  };
}

async function loadGlobalUsage() {
  const usageDiv = document.getElementById('global-usage');
  const today = new Date().toISOString().slice(0,10);
  const usageRef = db.collection('admin').doc('dailyUsage');

  try {
    const doc = await usageRef.get();
    let data = doc.exists ? doc.data() : { date: today, reads: 0, writes: 0, deletes: 0 };

    if (data.date !== today) {
      data = { date: today, reads: 0, writes: 0, deletes: 0 };
      await usageRef.set(data);
    }

    const readP = ((data.reads || 0) / 50000) * 100;
    const writeP = ((data.writes || 0) / 20000) * 100;
    const deleteP = ((data.deletes || 0) / 20000) * 100;

    usageDiv.innerHTML = `
      <h3 style="margin:0 0 15px;">Consumo Diario Global (Plan Spark)</h3>
      <div style="margin-bottom:10px;">
        <strong>Lecturas:</strong> ${data.reads || 0}/50,000
        <div style="height:20px;background:#e9ecef;border-radius:10px;overflow:hidden;margin-top:5px;">
          <div style="width:${readP}%;height:100%;background:#28a745;transition:width 0.5s;"></div>
        </div>
      </div>
      <div style="margin-bottom:10px;">
        <strong>Escrituras:</strong> ${data.writes || 0}/20,000
        <div style="height:20px;background:#e9ecef;border-radius:10px;overflow:hidden;margin-top:5px;">
          <div style="width:${writeP}%;height:100%;background:#ffc107;transition:width 0.5s;"></div>
        </div>
      </div>
      <div>
        <strong>Eliminaciones:</strong> ${data.deletes || 0}/20,000
        <div style="height:20px;background:#e9ecef;border-radius:10px;overflow:hidden;margin-top:5px;">
          <div style="width:${deleteP}%;height:100%;background:#dc3545;transition:width 0.5s;"></div>
        </div>
      </div>
      <small style="display:block;margin-top:10px;color:#666;">Contador centralizado actualizado en tiempo real.</small>
    `;
  } catch (err) {
    usageDiv.innerHTML = '<p>Error al cargar consumo global.</p>';
    console.error(err);
  }
}