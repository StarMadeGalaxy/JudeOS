const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:__dirname,testMatch:'registry-browser.spec.cjs',workers:1,timeout:60000,use:{baseURL:process.env.JUDEOS_BASE_URL,ignoreHTTPSErrors:false,launchOptions:{executablePath:process.env.JUDEOS_CHROMIUM_PATH||'/usr/bin/chromium'}}});
