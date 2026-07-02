Pod::Spec.new do |s|
  s.name = 'AllottedIap'
  s.version = '1.0.0'
  s.summary = 'StoreKit subscription bridge for Allotted Premium.'
  s.license = { :type => 'MIT' }
  s.author = 'Allotted'
  s.homepage = 'https://github.com/Lavish9999/Allotted'
  s.source = { :git => 'https://github.com/Lavish9999/Allotted.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '14.0'
  s.swift_version = '5.9'
  s.dependency 'Capacitor'
end
