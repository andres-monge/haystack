package dev.haystack.tv;

import static org.junit.Assert.*;

import android.Manifest;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.service.dreams.DreamService;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class DreamFixtureTest {
    @Test public void frameworkCanDiscoverOnlyTheProtectedDream() throws Exception {
        var context = RuntimeEnvironment.getApplication();
        var pm = context.getPackageManager();
        PackageInfo info = pm.getPackageInfo(context.getPackageName(),
                PackageManager.GET_SERVICES | PackageManager.GET_ACTIVITIES | PackageManager.GET_PERMISSIONS);
        assertNull(info.activities);
        assertNull(info.requestedPermissions);
        assertEquals(1, info.services.length);
        ServiceInfo service = info.services[0];
        assertEquals("dev.haystack.tv.HaystackDreamService", service.name);
        assertTrue(service.exported);
        assertEquals(Manifest.permission.BIND_DREAM_SERVICE, service.permission);
        var intent = new android.content.Intent(DreamService.SERVICE_INTERFACE).setPackage(context.getPackageName());
        var resolved = pm.queryIntentServices(intent, PackageManager.GET_META_DATA);
        assertEquals(1, resolved.size());
        try (var metadata = resolved.get(0).serviceInfo.loadXmlMetaData(pm, DreamService.DREAM_META_DATA)) {
            assertNotNull(metadata);
            while (metadata.next() != org.xmlpull.v1.XmlPullParser.START_TAG) { }
            assertEquals("dream", metadata.getName());
        }
    }

    @Test public void ownedFixtureRendersAcrossScreenShapes() {
        var context = RuntimeEnvironment.getApplication();
        Drawable art = context.getDrawable(R.drawable.fixture_art);
        assertNotNull(art);
        for (int[] size : new int[][] {{1920, 1080}, {1080, 1920}}) {
            Bitmap bitmap = Bitmap.createBitmap(size[0], size[1], Bitmap.Config.ARGB_8888);
            art.setBounds(0, 0, size[0], size[1]);
            art.draw(new Canvas(bitmap));
            assertEquals(255, android.graphics.Color.alpha(bitmap.getPixel(0, 0)));
            assertNotEquals(bitmap.getPixel(0, 0), bitmap.getPixel(size[0] / 2, size[1] - 1));
            bitmap.recycle();
        }
    }
}
