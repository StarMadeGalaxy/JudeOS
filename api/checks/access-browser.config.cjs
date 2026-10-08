const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:__dirname,testMatch:'access-browser.spec.cjs',timeout:60000,workers:1,use:{baseURL:process.env.JUDEOS_BASE_URL||'https://localhost:8443',ignoreHTTPSErrors:false,headless:true,launchOptions:process.env.JUDEOS_CHROMIUM_PATH?{executablePath:process.env.JUDEOS_CHROMIUM_PATH}:{}}});
