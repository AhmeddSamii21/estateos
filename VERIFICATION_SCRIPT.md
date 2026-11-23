# ESTATEOS - VERIFICATION GUIDE

## Quick Start Verification Script

### Step 1: Start Backend Server

```bash
cd backend
npm run dev
```

Expected output:
```
Server running on port 3000
Database connected successfully
```

### Step 2: Start Frontend Development Server

```bash
cd frontend
npm run dev
```

Expected output:
```
VITE v8.3.8  ready in 0.8s

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

### Step 3: Manual Testing Checklist

#### Authentication Tests

**A. Register New User**
1. Navigate to: http://localhost:5173/
2. Click "Login" in the sidebar (if logged in)
3. You should see the login page
4. Create a new account:
   - Email: test@example.com
   - Password: Test123!
   - Organization ID: org-1 (or create a new org)
   - First Name: Test
5. Verify you're redirected to Dashboard

**B. Login with Existing User**
1. Logout (click user menu → Logout)
2. Login with your credentials
3. Verify token is saved in localStorage
4. Verify you're on Dashboard

**C. Verify Protected Routes**
1. Try accessing /properties without login (should redirect to /login)
2. Login successfully
3. Navigate to /properties (should work)
4. Navigate to /dashboard (should work)
5. Navigate to /leads (should work)

#### Properties Module Tests

**A. Property List**
1. Navigate to /properties
2. Verify property grid appears
3. Test filtering by clicking a filter
4. Test pagination buttons
5. Click on a property to view details

**B. Create Property**
1. Navigate to /properties/new
2. Fill out the form:
   - Title: Test Apartment
   - Type: Apartment
   - Status: AVAILABLE
   - Price: 500000
   - Currency: USD
   - City: Cairo
   - Address: Test Street 123
   - Bedrooms: 2
   - Bathrooms: 1
   - Area: 150
   - Year Built: 2020
   - Description: Test description
3. Click "Save"
4. Verify redirect to property details

**C. View Property Details**
1. Go to a property detail page
2. Verify all fields are displayed
3. Try status dropdown (if you have ADMIN/MANAGER role)
4. Try "Edit" button
5. Try "Delete" button (if authorized)

**D. Edit Property**
1. Go to a property detail page
2. Click "Edit" button
3. Change the price
4. Click "Save"
5. Verify changes appear in details view

**E. Advanced Search with Map**
1. Navigate to /search
2. Click on the map
3. Add a marker
4. Click "Apply Map Bounds"
5. Verify properties filtered by map area

#### Dashboard Tests

**A. Dashboard Overview**
1. Verify Dashboard shows:
   - Total Properties count
   - Available Properties count
   - Sold Properties count
   - Portfolio Value
   - Sold Value
   - Recent properties list

**B. Loading States**
1. Navigate to Dashboard
2. Refresh the page
3. Verify loading indicator appears

**C. Empty States**
1. Register a new organization
2. Verify no properties in system
3. Dashboard should show "No properties" message

#### Language Switching Tests

**A. Switch to Arabic**
1. Click language toggle (English/Arabic)
2. Verify:
   - Language switches to Arabic
   - Direction changes to RTL
   - All text is in Arabic
   - Layout reflows correctly

**B. Switch to English**
1. Click language toggle
2. Verify:
   - Language switches to English
   - Direction changes to LTR
   - All text is in English
   - Layout reflows correctly

#### Responsive Design Tests

**A. Desktop (>1024px)**
1. Open browser window to 1920x1080
2. Verify:
   - Sidebar is fully visible
   - Property grid has 3-4 columns
   - Header displays all buttons

**B. Tablet (768-1024px)**
1. Resize browser to 768x1024
2. Verify:
   - Sidebar becomes icon-only
   - Property grid has 2-3 columns
   - Header is more compact

**C. Mobile (<768px)**
1. Resize browser to 375x667
2. Verify:
   - Sidebar has toggle button
   - Property grid has 1-2 columns
   - Touch targets are large enough
   - Can toggle sidebar

#### Error Handling Tests

**A. Form Validation**
1. Try to create property without title
2. Try to create property with negative price
3. Verify error message appears

**B. API Errors**
1. Login with wrong credentials
2. Verify error message shows
3. Logout
4. Try to access protected route without login
5. Verify redirect to login page

**C. Network Errors**
1. Stop backend server
2. Try to access any page
3. Verify error message shows

### Step 4: Production Build Verification

```bash
cd C:\Users\Dell\Desktop\Goose First Project
npm run build
```

Expected output:
```
✓ built in 1.32s
```

### Step 5: TypeScript Verification

```bash
npm run typecheck:frontend
npm run typecheck:backend
```

Both should pass with no errors.

### Step 6: Accessibility Check (Optional)

1. Tab through the application
2. Verify keyboard navigation works
3. Check focus states
4. Verify screen reader announcements (if using NVDA/JAWS)

---

## Common Issues and Solutions

### Issue: Can't connect to backend
**Solution:** Make sure backend is running on port 3000. Check backend logs.

### Issue: Token not persisting
**Solution:** Check browser localStorage for 'estateos.token'. Clear it and try logging in again.

### Issue: RTL not working
**Solution:** Refresh page after switching language. Check HTML direction attribute.

### Issue: Properties not loading
**Solution:** Check that backend has properties. Verify API base URL in browser console.

### Issue: Map not showing
**Solution:** Ensure Leaflet CDN is accessible. Check browser console for errors.

---

## Success Criteria

All tests pass when:
- ✅ You can login/register
- ✅ Token persists after refresh
- ✅ You can access all pages (with proper auth)
- ✅ You can create/edit/delete properties
- ✅ Dashboard shows real data
- ✅ Language switches work correctly
- ✅ Layout is responsive on all devices
- ✅ Forms validate inputs
- ✅ API errors are handled gracefully
- ✅ Build completes without errors

---

## Performance Benchmarks

- Initial page load: < 2 seconds
- Route transitions: < 500ms
- API response: < 500ms (local)
- Form submission: < 1 second
- Image upload: < 2 seconds

---

## Test Data Generation

To populate the database with test data, you can:

1. **Use existing API:**
   ```bash
   POST /api/auth/register
   Body: { email, password, organizationId, firstName }
   ```

2. **Create properties manually** using the UI
3. **Use database seed script** (if provided)

---

## Support

For issues or questions:
1. Check browser console for errors
2. Check backend server logs
3. Review this verification guide
4. Check FINAL_COMPLETION_REPORT.md for architecture details

---

*Verification guide for EstateOS v1.0*
