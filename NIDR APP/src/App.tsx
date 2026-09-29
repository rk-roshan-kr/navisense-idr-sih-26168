import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { AppNavigator } from './navigation/AppNavigator';
import { requestCorePermissions } from './utils/permissionUtils';

const App: React.FC = () => {
  useEffect(() => {
    requestCorePermissions();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <AppNavigator />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
});

export default App;
