import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// How a release APK is signed. `keystore.properties` is written by whoever is
// building - the workflow makes one from the ANDROID_KEYSTORE secrets, or from a
// keystore it generates itself so the APK still installs on a phone - and is
// never committed. With no file there the release build is simply unsigned,
// which is what a local `tauri android build` produces. See docs/mobile.md.
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "ch.emilvinu.nib"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "ch.emilvinu.nib"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (keystoreProperties.containsKey("storeFile")) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.14.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // An AI provider's key, in the file Android encrypts with a Keystore key. The
    // phone's half of what the Credential Manager and the Keychain do on a desktop;
    // see secrets.rs and the Secrets bridge in MainActivity.kt.
    //
    // 1.1.0 and not 1.0.0. `MasterKey`, which is the class that asks the Keystore
    // for a hardware-backed key, was added in 1.1.0; the 1.0.0 artifact holds only
    // the alias-based `MasterKeys` it replaced, and with that on the path the
    // import does not resolve and the `create` call falls through to the overload
    // that takes a file name first - which is why the build failed with "inferred
    // type is MainActivity but String was expected" rather than with anything
    // about a version.
    implementation("androidx.security:security-crypto:1.1.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
}

apply(from = "tauri.build.gradle.kts")